import { MAX_EXCERPT_CHARS, type JobType } from '@samm/shared';
import { HttpError } from '../lib/util.js';
import * as ft from './repo.js';
import { adjustSpec, createSpec, type PipelineInput } from './pipeline.js';

type Ctx = { user: string; cdcId: string };
type Step = (s: string) => Promise<void>;

async function pipelineInput(id: string): Promise<PipelineInput> {
  const [detail, context] = await Promise.all([ft.getFileTypeDetail(id), ft.getContext(id)]);
  return { excerpt: context.excerpt, anonymized: context.anonymized, notes: detail.notes, sampleFileName: detail.sampleFileName, documents: context.documents };
}

export async function runFileTypeJob(type: JobType, id: string, payload: Record<string, unknown>, ctx: Ctx, step: Step): Promise<{ seq: number; message: string }> {
  if (type === 'filetype_create') {
    const input = await pipelineInput(id);
    const { seq } = await ft.getSpec(id);
    const result = await createSpec(input, ctx, step);
    await step('Enregistrement');
    const v = await ft.saveSpecVersion(id, seq, result.spec, { user: ctx.user, origin: 'ia', comment: result.summary, remarks: result.remarks });
    return { seq: v.seq, message: `Fiche créée : ${result.spec.recordTypes.length} type(s) de ligne` };
  }

  const baseSeq = Number(payload.baseSeq);
  const { seq, spec } = await ft.getSpec(id);
  if (!spec) throw new HttpError(400, 'Cette fiche n’a pas encore de version.');
  if (seq !== baseSeq) throw new HttpError(409, 'La fiche a été modifiée pendant le traitement. Relancez l’ajustement.');
  const extra = String(payload.extraLines ?? '').trim();
  if (extra) {
    // Les lignes problématiques rejoignent l'extrait de référence, pour les ajustements suivants aussi.
    const context = await ft.getContext(id);
    const merged = `${context.excerpt}\n${extra}`;
    context.excerpt = merged.length > MAX_EXCERPT_CHARS ? merged.slice(merged.length - MAX_EXCERPT_CHARS).replace(/^[^\n]*\n/, '') : merged;
    await ft.putContext(id, context);
  }
  const input = await pipelineInput(id);
  const result = await adjustSpec(spec, input, String(payload.instruction ?? ''), ctx, step);
  await step('Enregistrement');
  const v = await ft.saveSpecVersion(id, baseSeq, result.spec, { user: ctx.user, origin: 'ia', comment: result.summary, remarks: result.remarks });
  return { seq: v.seq, message: 'Fiche ajustée' };
}
