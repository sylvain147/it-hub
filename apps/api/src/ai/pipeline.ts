/**
 * Les traitements IA du générateur de CDC.
 *
 * Stratégie d'économie :
 *  1. une transcription n'est lue qu'une fois, par le modèle rapide, qui en tire des notes structurées
 *     (≈ 5 à 10 fois plus courtes) ; seules ces notes sont ensuite envoyées au modèle de rédaction ;
 *  2. les mises à jour ne renvoient que les sections modifiées, et ne reçoivent que les sections utiles ;
 *  3. les traductions sont mises en cache bloc par bloc : seul ce qui a changé est retraduit ;
 *  4. les instructions système sont stables et mises en cache.
 */
import { randomBytes } from 'node:crypto';
import {
  collectImageSrcs,
  docToMarkdown,
  emptyDoc,
  markdownToDoc,
  type CdcDocument,
  type CdcMeta,
  type Jalon,
  type Question,
  type Section,
  type TranslationLanguage,
} from '@samm/shared';
import { nowIso, sha256 } from '../lib/util.js';
import { getCachedTranslations, putCachedTranslations } from '../db/repo.js';
import { callStructured } from './llm.js';
import { DRAFT_SYSTEM, EXTRACTION_SYSTEM, TRANSLATION_SYSTEM, UPDATE_SYSTEM } from './prompts.js';
import { draftSchema, extractionSchema, translationSchema, updateSchema, type Extraction, type Update } from './schemas.js';

type Ctx = { user: string; cdcId: string };

export const sectionId = () => randomBytes(5).toString('hex');
const jalonId = () => randomBytes(4).toString('hex');

const today = () => nowIso().slice(0, 10);

// ---------------------------------------------------------------------------
// Mise en forme des entrées
// ---------------------------------------------------------------------------

export function taggedSection(s: Section): string {
  return `<section id="${s.id}" kind="${s.kind}" title="${escapeAttr(s.title)}">\n${docToMarkdown(s.content)}\n</section>`;
}

function escapeAttr(s: string) {
  return s.replace(/"/g, '&quot;');
}

function outline(doc: CdcDocument): string {
  return doc.sections.map((s) => `- [${s.id}] ${s.title} (${s.kind})`).join('\n');
}

function metaBlock(meta: Partial<CdcMeta>): string {
  const lines = [
    `Titre : ${meta.title || '(à proposer)'}`,
    `Prestataire : ${meta.prestataire || '(inconnu)'}`,
    `Projet : ${meta.projet || '(non renseigné)'}`,
    `Phase : ${meta.phase ?? '(inconnue)'}`,
    `Jalons : ${meta.jalons?.length ? meta.jalons.map((j) => `${j.label} : ${j.date || '?'}`).join(' ; ') : '(aucun)'}`,
    `Estimation : ${meta.estimationJours != null ? `${meta.estimationJours} jours/homme` : '(inconnue)'}`,
  ];
  return `<metadonnees>\n${lines.join('\n')}\n</metadonnees>`;
}

function questionsBlock(questions: Question[]): string {
  if (!questions.length) return '<questions_ouvertes>(aucune)</questions_ouvertes>';
  return `<questions_ouvertes>\n${questions.map((q) => `- [${q.id}] (${q.sectionTitle}) ${q.text}`).join('\n')}\n</questions_ouvertes>`;
}

// ---------------------------------------------------------------------------
// 1. Tri d'une transcription (modèle rapide)
// ---------------------------------------------------------------------------

export async function extractTranscript(text: string, title: string, ctx: Ctx): Promise<Extraction> {
  return callStructured({
    tier: 'fast',
    operation: 'extraction',
    system: EXTRACTION_SYSTEM,
    input: `Date du jour : ${today()}\nTitre donné par l'utilisateur : ${title || '(aucun)'}\n\n<transcription>\n${text}\n</transcription>`,
    schema: extractionSchema,
    maxTokens: 8000,
    effort: 'low',
    ctx,
  });
}

// ---------------------------------------------------------------------------
// 2. Rédaction initiale (modèle de rédaction)
// ---------------------------------------------------------------------------

export interface DraftResult {
  document: CdcDocument;
  questions: Omit<Question, 'id' | 'createdAt' | 'updatedAt'>[];
}

export async function draftCdc(notes: string, known: CdcMeta, ctx: Ctx, projectContext = ''): Promise<DraftResult> {
  const blocks = [
    `Date du jour : ${today()}`,
    metaBlock(known),
    projectContext.trim() && `<fiche_projet>\n${projectContext}\n</fiche_projet>`,
    notes.trim() && `<notes_de_reunion>\n${notes}\n</notes_de_reunion>`,
  ];
  const out = await callStructured({
    tier: 'smart',
    operation: 'redaction',
    system: DRAFT_SYSTEM,
    input: blocks.filter(Boolean).join('\n\n'),
    schema: draftSchema,
    maxTokens: 16000,
    effort: 'medium',
    ctx,
  });

  // Les valeurs saisies par l'utilisateur priment sur celles proposées par l'IA.
  const meta: CdcMeta = {
    ...known,
    title: known.title || out.title || 'Cahier des charges',
    prestataire: known.prestataire || out.prestataire,
    phase: known.phase ?? out.phase,
    jalons: known.jalons.length ? known.jalons : toJalons(out.jalons),
    estimationJours: known.estimationJours ?? out.estimationJours,
  };
  const sections = normalizeSections(
    out.sections.map((s) => ({ id: sectionId(), kind: s.kind, title: s.title.trim() || 'Section', content: markdownToDoc(s.markdown) })),
  );
  const questions = out.questions.map((q) => ({
    text: q.text,
    why: q.why,
    priority: q.priority,
    sectionId: matchSection(sections, q.sectionTitle)?.id ?? null,
    sectionTitle: q.sectionTitle,
    status: 'ouverte' as const,
    answer: '',
    answeredBy: '',
  }));
  return { document: { meta, sections }, questions };
}

function toJalons(js: { label: string; date: string }[]): Jalon[] {
  return js
    .filter((j) => j.label.trim() || j.date)
    .map((j) => ({ id: jalonId(), label: j.label.trim(), date: /^\d{4}-\d{2}-\d{2}$/.test(j.date) ? j.date : '' }));
}

function matchSection(sections: Section[], title: string): Section | undefined {
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^[\d.\s]+/, '').trim();
  const t = norm(title);
  return sections.find((s) => norm(s.title) === t) ?? sections.find((s) => t && (norm(s.title).includes(t) || t.includes(norm(s.title))));
}

/** Garantit : « Contexte » en premier (unique), « Annexes » en dernier (unique). */
export function normalizeSections(sections: Section[]): Section[] {
  const contexte = sections.filter((s) => s.kind === 'contexte');
  const annexes = sections.filter((s) => s.kind === 'annexes');
  const others = sections.filter((s) => s.kind === 'standard');
  const first: Section = contexte[0] ?? { id: sectionId(), kind: 'contexte', title: 'Contexte', content: emptyDoc() };
  // Contextes en double : fusionnés dans le premier.
  for (const extra of contexte.slice(1)) first.content = { type: 'doc', content: [...(first.content.content ?? []), ...(extra.content.content ?? [])] };
  const result = [first, ...others];
  if (annexes.length) {
    const a = annexes[0]!;
    for (const extra of annexes.slice(1)) a.content = { type: 'doc', content: [...(a.content.content ?? []), ...(extra.content.content ?? [])] };
    result.push(a);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 3. Mises à jour (nouvelle transcription, réponses, retravail d'une section)
// ---------------------------------------------------------------------------

export interface UpdateResult {
  document: CdcDocument;
  summary: string;
  newQuestions: DraftResult['questions'];
  resolvedQuestionIds: string[];
  changedSectionIds: string[];
}

async function runUpdate(
  doc: CdcDocument,
  visible: Section[],
  newInfo: string,
  openQuestions: Question[],
  operation: string,
  ctx: Ctx,
): Promise<UpdateResult> {
  const input = [
    `Date du jour : ${today()}`,
    metaBlock(doc.meta),
    `<plan_du_document>\n${outline(doc)}\n</plan_du_document>`,
    `<sections_fournies>\n${visible.map(taggedSection).join('\n\n')}\n</sections_fournies>`,
    questionsBlock(openQuestions),
    newInfo,
  ].join('\n\n');
  const out = await callStructured({
    tier: 'smart',
    operation,
    system: UPDATE_SYSTEM,
    input,
    schema: updateSchema,
    maxTokens: 16000,
    effort: 'medium',
    ctx,
  });
  return applyUpdate(doc, out, new Set(visible.map((s) => s.id)), new Set(openQuestions.map((q) => q.id)));
}

/** Applique la réponse du modèle en refusant toute modification hors des sections qui lui ont été montrées. */
export function applyUpdate(doc: CdcDocument, out: Update, allowedIds: Set<string>, openQuestionIds: Set<string>): UpdateResult {
  const sections = doc.sections.map((s) => ({ ...s }));
  const changed: string[] = [];

  for (const ch of out.sectionChanges) {
    const existing = ch.sectionId ? sections.find((s) => s.id === ch.sectionId) : undefined;
    if (existing) {
      if (!allowedIds.has(existing.id)) continue;
      const content = keepImages(existing.content, markdownToDoc(ch.markdown));
      existing.content = content;
      if (existing.kind === 'standard' && ch.title.trim()) existing.title = ch.title.trim();
      changed.push(existing.id);
      continue;
    }
    if (ch.sectionId) continue; // identifiant inconnu : ignoré
    const isAnnex = /^annexes?$/i.test(ch.title.trim());
    const annexIdx = sections.findIndex((s) => s.kind === 'annexes');
    if (isAnnex && annexIdx >= 0) {
      const a = sections[annexIdx]!;
      a.content = { type: 'doc', content: [...(a.content.content ?? []), ...(markdownToDoc(ch.markdown).content ?? [])] };
      changed.push(a.id);
      continue;
    }
    const section: Section = {
      id: sectionId(),
      kind: isAnnex ? 'annexes' : 'standard',
      title: ch.title.trim() || 'Nouvelle section',
      content: markdownToDoc(ch.markdown),
    };
    if (isAnnex) sections.push(section);
    else {
      const afterIdx = sections.findIndex((s) => s.id === ch.insertAfterSectionId);
      const limit = annexIdx >= 0 ? annexIdx : sections.length;
      const pos = afterIdx >= 0 ? Math.min(afterIdx + 1, limit) : limit;
      sections.splice(Math.max(pos, 1), 0, section);
    }
    changed.push(section.id);
  }

  const m = out.meta;
  const meta: CdcMeta = {
    ...doc.meta,
    prestataire: m.prestataire ?? doc.meta.prestataire,
    phase: m.phase ?? doc.meta.phase,
    jalons: m.jalons ? mergeJalons(doc.meta.jalons, m.jalons) : doc.meta.jalons,
    estimationJours: m.estimationJours ?? doc.meta.estimationJours,
  };
  const finalSections = normalizeSections(sections);
  return {
    document: { meta, sections: finalSections },
    summary: out.summary,
    newQuestions: out.newQuestions.map((q) => ({
      text: q.text,
      why: q.why,
      priority: q.priority,
      sectionId: matchSection(finalSections, q.sectionTitle)?.id ?? null,
      sectionTitle: q.sectionTitle,
      status: 'ouverte' as const,
      answer: '',
      answeredBy: '',
    })),
    resolvedQuestionIds: out.resolvedQuestionIds.filter((id) => openQuestionIds.has(id)),
    changedSectionIds: [...new Set(changed)],
  };
}

function mergeJalons(previous: Jalon[], next: { label: string; date: string }[]): Jalon[] {
  return toJalons(next).map((j) => ({ ...j, id: previous.find((p) => p.label === j.label)?.id ?? j.id }));
}

/** Filet de sécurité : une image présente avant la mise à jour ne doit jamais disparaître. */
function keepImages(before: Section['content'], after: Section['content']): Section['content'] {
  const kept = new Set(collectImageSrcs(after));
  const lost = collectImageSrcs(before).filter((src) => !kept.has(src));
  if (!lost.length) return after;
  return { type: 'doc', content: [...(after.content ?? []), ...lost.map((src) => ({ type: 'image', attrs: { src, alt: null, title: null } }))] };
}

export async function integrateTranscript(
  doc: CdcDocument,
  notes: string,
  openQuestions: Question[],
  ctx: Ctx,
): Promise<UpdateResult> {
  // Une nouvelle réunion peut toucher n'importe quelle partie : on fournit tout le document.
  return runUpdate(doc, doc.sections, `<nouvelles_notes_de_reunion>\n${notes}\n</nouvelles_notes_de_reunion>`, openQuestions, 'nouvelle_transcription', ctx);
}

export async function integrateAnswers(
  doc: CdcDocument,
  answered: Question[],
  openQuestions: Question[],
  ctx: Ctx,
): Promise<UpdateResult> {
  // Seules les sections concernées par les réponses sont envoyées (sauf question transverse).
  const ids = new Set(answered.map((q) => q.sectionId).filter((id): id is string => !!id));
  const transverse = answered.some((q) => !q.sectionId || !doc.sections.some((s) => s.id === q.sectionId));
  const visible = transverse ? doc.sections : doc.sections.filter((s) => ids.has(s.id));
  const block = answered.map((q) => `- Question (${q.sectionTitle}) : ${q.text}\n  Réponse : ${q.answer}`).join('\n');
  return runUpdate(doc, visible, `<reponses_du_charge_de_projet>\n${block}\n</reponses_du_charge_de_projet>`, openQuestions, 'integration_reponses', ctx);
}

export async function reworkSection(
  doc: CdcDocument,
  section: Section,
  instruction: string,
  openQuestions: Question[],
  ctx: Ctx,
): Promise<UpdateResult> {
  const result = await runUpdate(
    doc,
    [section],
    `<consigne>\nRetravaille uniquement la section « ${section.title} » (id ${section.id}) selon cette consigne :\n${instruction}\n</consigne>`,
    openQuestions.filter((q) => q.sectionId === section.id),
    'retravail_section',
    ctx,
  );
  return result;
}

// ---------------------------------------------------------------------------
// 4. Traduction (modèle rapide + cache par bloc)
// ---------------------------------------------------------------------------

const LANG_NAMES: Record<TranslationLanguage, string> = { en: 'anglais', de: 'allemand' };
const MAX_BATCH_CHARS = 20_000;

export async function translateDocument(doc: CdcDocument, lang: TranslationLanguage, ctx: Ctx): Promise<{ document: CdcDocument; translatedBlocks: number; cachedBlocks: number }> {
  const items: { key: string; text: string }[] = [
    { key: 'meta.title', text: doc.meta.title },
    ...doc.meta.jalons.filter((j) => j.label).map((j) => ({ key: `jalon.${j.id}`, text: j.label })),
    ...doc.sections.flatMap((s) => [
      { key: `title.${s.id}`, text: s.title },
      { key: `body.${s.id}`, text: docToMarkdown(s.content) },
    ]),
  ].filter((i) => i.text.trim());

  const hashOf = (t: string) => sha256(`${lang}\n${t}`);
  const cache = await getCachedTranslations(items.map((i) => hashOf(i.text)));
  const result = new Map<string, string>();
  const missing: typeof items = [];
  for (const it of items) {
    const hit = cache.get(hashOf(it.text));
    if (hit !== undefined) result.set(it.key, hit);
    else missing.push(it);
  }

  // Les textes identiques ne sont traduits qu'une fois.
  const uniqueMissing = [...new Map(missing.map((m) => [m.text, m])).values()];
  const batches: (typeof items)[] = [];
  let current: typeof items = [];
  let size = 0;
  for (const it of uniqueMissing) {
    if (current.length && size + it.text.length > MAX_BATCH_CHARS) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(it);
    size += it.text.length;
  }
  if (current.length) batches.push(current);

  const fresh: { hash: string; text: string }[] = [];
  for (const batch of batches) {
    const out = await callStructured({
      tier: 'fast',
      operation: 'traduction',
      system: TRANSLATION_SYSTEM,
      input: `Langue cible : ${LANG_NAMES[lang]}\n\n<elements>\n${JSON.stringify(batch.map((b) => ({ key: b.key, text: b.text })), null, 1)}\n</elements>`,
      schema: translationSchema,
      maxTokens: 16000,
      effort: 'low',
      ctx,
    });
    const byKey = new Map(out.items.map((i) => [i.key, i.text]));
    for (const it of batch) {
      const translated = byKey.get(it.key);
      if (translated === undefined) throw new Error(`Traduction incomplète (élément « ${it.key} » manquant). Relancez la traduction.`);
      fresh.push({ hash: hashOf(it.text), text: translated });
    }
  }
  if (fresh.length) await putCachedTranslations(fresh);
  const freshByHash = new Map(fresh.map((f) => [f.hash, f.text]));
  for (const it of missing) result.set(it.key, freshByHash.get(hashOf(it.text))!);

  const t = (key: string, fallback: string) => result.get(key) ?? fallback;
  const document: CdcDocument = {
    meta: {
      ...doc.meta,
      title: t('meta.title', doc.meta.title),
      jalons: doc.meta.jalons.map((j) => ({ ...j, label: t(`jalon.${j.id}`, j.label) })),
    },
    sections: doc.sections.map((s) => ({
      ...s,
      title: t(`title.${s.id}`, s.title),
      content: result.has(`body.${s.id}`) ? keepImages(s.content, markdownToDoc(result.get(`body.${s.id}`)!)) : s.content,
    })),
  };
  return { document, translatedBlocks: missing.length, cachedBlocks: items.length - missing.length };
}
