/**
 * Tâches IA asynchrones. Une génération peut prendre plus d'une minute : l'API crée la tâche et rend la main,
 * la tâche s'exécute dans une Lambda dédiée (ou en arrière-plan en local), le navigateur suit son avancement.
 */
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import type { CdcDocument, JobInfo, JobType, Question, TranslationLanguage } from '@samm/shared';
import { config } from '../config.js';
import { HttpError, newId, nowIso } from '../lib/util.js';
import * as repo from '../db/repo.js';
import { keys } from '../db/schema.js';
import { fileTypeKeys } from '../filetypes/repo.js';
import { runFileTypeJob } from '../filetypes/jobs.js';
import { tmaKeys } from '../tma/repo.js';
import { runTmaJob } from '../tma/jobs.js';
import { projectKeys } from '../projects/repo.js';
import { runProjectJob } from '../projects/jobs.js';
import { blobs } from '../storage/blobs.js';
import { assertBudget } from '../ai/llm.js';
import * as ai from '../ai/pipeline.js';

/** Élément verrouillé pendant le job. */
function targetKey(type: JobType, targetId: string) {
  if (type === 'tma_classify') return tmaKeys.desk();
  if (type === 'tma_synthesis') return tmaKeys.month(targetId);
  if (type.startsWith('filetype_')) return fileTypeKeys.meta(targetId);
  if (type.startsWith('project_')) return projectKeys.meta(targetId);
  return keys.cdc(targetId);
}

export async function startJob(type: JobType, targetId: string, user: string, payload: Record<string, unknown>): Promise<JobInfo> {
  await assertBudget();
  const job = await repo.createJob({ type, targetId, user, payload });
  try {
    await repo.claimForJob(targetKey(type, targetId), job.id);
  } catch (e) {
    await repo.updateJob(job.id, { status: 'erreur', error: (e as Error).message });
    await repo.clearJobPayload(job.id);
    throw e;
  }
  await dispatch(job.id);
  return repo.jobInfo(job);
}

let lambda: LambdaClient | null = null;

async function dispatch(jobId: string) {
  if (config.runtime === 'aws') {
    lambda ??= new LambdaClient({});
    await lambda.send(
      new InvokeCommand({
        FunctionName: config.workerFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify({ jobId })),
      }),
    );
  } else {
    setImmediate(() => void runJob(jobId));
  }
}

export async function runJob(jobId: string): Promise<void> {
  const job = await repo.getJob(jobId);
  if (!job || job.status !== 'en_attente') return; // déjà traité (invocation rejouée)
  const ctx = { user: job.user, cdcId: job.targetId };
  const step = (s: string) => repo.updateJob(jobId, { status: 'en_cours', step: s });
  try {
    await step('Démarrage');
    const p = job.payload;
    let resultSeq: number | null = null;
    let doneMessage = 'Terminé';
    switch (job.type) {
      case 'create_from_transcript':
        resultSeq = await createFromTranscript(
          job.targetId,
          p.textKey ? await pendingText(p) : '',
          String(p.title ?? ''),
          ctx,
          step,
          p.contextKey ? await pendingText({ textKey: p.contextKey }) : '',
        );
        break;
      case 'add_transcript':
        resultSeq = await addTranscript(job.targetId, Number(p.baseSeq), await pendingText(p), String(p.title ?? ''), ctx, step);
        break;
      case 'integrate_answers':
        resultSeq = await integrateAnswers(job.targetId, Number(p.baseSeq), ctx, step);
        break;
      case 'rework_section':
        resultSeq = await rework(job.targetId, Number(p.baseSeq), String(p.sectionId), String(p.instruction), ctx, step);
        break;
      case 'translate':
        doneMessage = await translate(job.targetId, p.lang as TranslationLanguage, ctx, step);
        break;
      case 'filetype_create':
      case 'filetype_adjust':
        ({ seq: resultSeq, message: doneMessage } = await runFileTypeJob(job.type, job.targetId, p, ctx, step));
        break;
      case 'tma_classify':
      case 'tma_synthesis':
        doneMessage = await runTmaJob(job.type, job.targetId, p, ctx, step);
        break;
      case 'project_digest':
      case 'project_report':
        doneMessage = await runProjectJob(job.type, job.targetId, p, ctx, step);
        break;
    }
    // Libère le CDC avant d'annoncer la fin, pour que le navigateur puisse éditer dès qu'il voit « terminé ».
    await repo.releaseJob(targetKey(job.type, job.targetId), jobId);
    await repo.updateJob(jobId, { status: 'termine', step: doneMessage, resultVersionSeq: resultSeq });
  } catch (e) {
    console.error(`Job ${jobId} (${job.type}) en erreur`, e);
    const message = e instanceof HttpError ? e.message : `${(e as Error).message || 'Erreur inconnue'}`;
    await repo.releaseJob(targetKey(job.type, job.targetId), jobId);
    await repo.updateJob(jobId, { status: 'erreur', error: message });
  } finally {
    await repo.clearJobPayload(jobId);
  }
}

type Step = (s: string) => Promise<void>;

async function pendingText(payload: Record<string, unknown>): Promise<string> {
  const buf = await blobs().get(String(payload.textKey));
  if (!buf) throw new HttpError(404, 'Transcription introuvable. Relancez l’opération.');
  return buf.toString('utf8');
}
type Ctx = { user: string; cdcId: string };

async function currentDoc(cdcId: string, expectedSeq?: number): Promise<{ doc: CdcDocument; seq: number }> {
  const d = await repo.getCdcDetail(cdcId);
  if (expectedSeq !== undefined && d.currentVersion.seq !== expectedSeq) {
    throw new HttpError(409, 'Le cahier des charges a été modifié pendant le traitement. Relancez l’opération.');
  }
  return { doc: d.document, seq: d.currentVersion.seq };
}

function toQuestions(qs: ai.DraftResult['questions']): Question[] {
  const now = nowIso();
  return qs.map((q) => ({ ...q, id: newId(), createdAt: now, updatedAt: now }));
}

/**
 * Génération initiale. Sources possibles : une transcription (triée d'abord par le modèle rapide)
 * et/ou les informations du projet de rattachement (déjà compactes : envoyées telles quelles).
 */
async function createFromTranscript(cdcId: string, text: string, title: string, ctx: Ctx, step: Step, projectContext = '') {
  const { doc, seq } = await currentDoc(cdcId);
  let extraction: Awaited<ReturnType<typeof ai.extractTranscript>> | null = null;
  if (text.trim()) {
    await step('Tri de la transcription');
    extraction = await ai.extractTranscript(text, title || doc.meta.title, ctx);
    await repo.addSource(cdcId, { title: title || extraction.titre, text, notes: extraction.notes, user: ctx.user });
  }
  if (!extraction && !projectContext.trim()) throw new HttpError(400, 'Aucune information à partir de laquelle rédiger.');

  await step('Rédaction du cahier des charges');
  const known = { ...doc.meta, title: title || doc.meta.title };
  // Les champs que l'utilisateur n'a pas renseignés peuvent être déduits de la transcription.
  const meta = extraction
    ? {
        ...known,
        prestataire: known.prestataire || extraction.prestataire,
        phase: known.phase ?? extraction.phase,
        estimationJours: known.estimationJours ?? extraction.estimationJours,
        jalons: known.jalons.length
          ? known.jalons
          : extraction.jalons.map((j) => ({ id: ai.sectionId(), label: j.label, date: /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : '' })),
      }
    : known;
  const draft = await ai.draftCdc(extraction?.notes ?? '', meta, ctx, projectContext);
  // Conserve les annexes déjà présentes (images collées pendant la génération, par exemple).
  const existingAnnexes = doc.sections.find((s) => s.kind === 'annexes' && (s.content.content?.length ?? 0) > 1);
  if (existingAnnexes && !draft.document.sections.some((s) => s.kind === 'annexes')) draft.document.sections.push(existingAnnexes);

  await step('Enregistrement');
  const from = [extraction && `la transcription${title ? ` « ${title} »` : ''}`, projectContext && 'la fiche projet'].filter(Boolean).join(' et de ');
  const version = await repo.saveVersion(cdcId, seq, draft.document, {
    user: ctx.user,
    origin: 'ia',
    comment: `Génération à partir de ${from}`,
  });
  await repo.putQuestions(cdcId, toQuestions(draft.questions));
  return version.seq;
}

async function addTranscript(cdcId: string, baseSeq: number, text: string, title: string, ctx: Ctx, step: Step) {
  const { doc } = await currentDoc(cdcId, baseSeq);
  await step('Tri de la transcription');
  const extraction = await ai.extractTranscript(text, title, ctx);
  const sourceTitle = title || extraction.titre;
  await repo.addSource(cdcId, { title: sourceTitle, text, notes: extraction.notes, user: ctx.user });

  await step('Intégration au cahier des charges');
  const open = (await repo.listQuestions(cdcId)).filter((q) => q.status === 'ouverte');
  const result = await ai.integrateTranscript(doc, extraction.notes, open, ctx);

  await step('Enregistrement');
  const version = await repo.saveVersion(cdcId, baseSeq, result.document, {
    user: ctx.user,
    origin: 'ia',
    comment: `Transcription « ${sourceTitle} » : ${result.summary}`,
  });
  const now = nowIso();
  const resolved = open
    .filter((q) => result.resolvedQuestionIds.includes(q.id))
    .map((q) => ({ ...q, status: 'integree' as const, answer: q.answer || `Réponse apportée par la transcription « ${sourceTitle} ».`, updatedAt: now }));
  await repo.putQuestions(cdcId, [...resolved, ...toQuestions(result.newQuestions)]);
  return version.seq;
}

async function integrateAnswers(cdcId: string, baseSeq: number, ctx: Ctx, step: Step) {
  const { doc } = await currentDoc(cdcId, baseSeq);
  const all = await repo.listQuestions(cdcId);
  const answered = all.filter((q) => q.status === 'repondue' && q.answer.trim());
  if (!answered.length) throw new HttpError(400, 'Aucune réponse à intégrer.');
  const open = all.filter((q) => q.status === 'ouverte');

  await step('Intégration des réponses');
  const result = await ai.integrateAnswers(doc, answered, open, ctx);

  await step('Enregistrement');
  const version = await repo.saveVersion(cdcId, baseSeq, result.document, {
    user: ctx.user,
    origin: 'ia',
    comment: `Intégration de ${answered.length} réponse${answered.length > 1 ? 's' : ''} : ${result.summary}`,
  });
  const now = nowIso();
  const updated = [
    ...answered.map((q) => ({ ...q, status: 'integree' as const, updatedAt: now })),
    ...open.filter((q) => result.resolvedQuestionIds.includes(q.id)).map((q) => ({ ...q, status: 'integree' as const, updatedAt: now })),
  ];
  await repo.putQuestions(cdcId, [...updated, ...toQuestions(result.newQuestions)]);
  return version.seq;
}

async function rework(cdcId: string, baseSeq: number, sectionId: string, instruction: string, ctx: Ctx, step: Step) {
  const { doc } = await currentDoc(cdcId, baseSeq);
  const section = doc.sections.find((s) => s.id === sectionId);
  if (!section) throw new HttpError(404, 'Section introuvable.');
  const open = (await repo.listQuestions(cdcId)).filter((q) => q.status === 'ouverte');

  await step(`Réécriture de « ${section.title} »`);
  const result = await ai.reworkSection(doc, section, instruction, open, ctx);
  if (!result.changedSectionIds.length) throw new HttpError(422, 'L’assistant n’a proposé aucune modification. Précisez la consigne.');

  await step('Enregistrement');
  const version = await repo.saveVersion(cdcId, baseSeq, result.document, {
    user: ctx.user,
    origin: 'ia',
    comment: `Section « ${section.title} » retravaillée : ${instruction.slice(0, 200)}`,
  });
  const now = nowIso();
  const resolved = open.filter((q) => result.resolvedQuestionIds.includes(q.id)).map((q) => ({ ...q, status: 'integree' as const, updatedAt: now }));
  await repo.putQuestions(cdcId, [...resolved, ...toQuestions(result.newQuestions)]);
  return version.seq;
}

async function translate(cdcId: string, lang: TranslationLanguage, ctx: Ctx, step: Step): Promise<string> {
  const detail = await repo.getCdcDetail(cdcId);
  await step(`Traduction (${lang.toUpperCase()})`);
  const { document, translatedBlocks, cachedBlocks } = await ai.translateDocument(detail.document, lang, ctx);
  await repo.putTranslation(cdcId, { lang, versionSeq: detail.currentVersion.seq, versionLabel: detail.currentVersion.label, createdBy: ctx.user }, document);
  return `Terminé (${translatedBlocks} bloc(s) traduit(s), ${cachedBlocks} repris du cache)`;
}
