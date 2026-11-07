/**
 * Documents de sprint rédigés par l'IA (sur demande uniquement) : compte rendu et préparation.
 *
 * Économie : le modèle de rédaction ne reçoit que les éléments calculés par le code (quelques Ko) ;
 * les descriptions des tickets ne lui sont pas envoyées.
 */
import { sprintPreparationToMarkdown, sprintReportToMarkdown, type SprintDocKind } from '@samm/shared';
import { HttpError } from '../lib/util.js';
import { callStructured, type StructuredCall } from '../ai/llm.js';
import * as repo from './repo.js';
import { SPRINT_PREPARATION_SYSTEM, SPRINT_REVIEW_SYSTEM } from './prompts.js';
import { sprintDocSchema, type SprintDocOutput } from './ai-schemas.js';
import { sprintNumbers } from './views.js';

type Ctx = { user: string; cdcId: string };
type Step = (s: string) => Promise<void>;

export const JOB_OF_DOC = { compte_rendu: 'sprint_review', preparation: 'sprint_preparation' } as const satisfies Record<SprintDocKind, string>;
const DOC_OF_JOB = { sprint_review: 'compte_rendu', sprint_preparation: 'preparation' } as const;

/** Appel au modèle pour un document de sprint (utilisé par le job et par l'export du prompt). */
export async function sprintDocCall(kind: SprintDocKind, sprintId: string | number, ctx: Ctx): Promise<StructuredCall<SprintDocOutput>> {
  const sprint = repo.toSprint(await repo.requireSprintItem(sprintId));
  const { report, preparation, labels } = await sprintNumbers(sprint);
  const common = { tier: 'smart' as const, schema: sprintDocSchema, maxTokens: 4000, effort: 'medium' as const, ctx };
  if (kind === 'compte_rendu') {
    if (!report) throw new HttpError(400, 'Ce sprint n’a pas encore démarré : préparez-le plutôt.');
    return { ...common, operation: 'sprint_compte_rendu', system: SPRINT_REVIEW_SYSTEM, input: `<chiffres_du_sprint>\n${sprintReportToMarkdown(report, labels)}\n</chiffres_du_sprint>` };
  }
  if (!preparation) throw new HttpError(400, 'Ce sprint est clos : rédigez plutôt son compte rendu.');
  return { ...common, operation: 'sprint_preparation', system: SPRINT_PREPARATION_SYSTEM, input: `<preparation_du_sprint>\n${sprintPreparationToMarkdown(preparation, labels)}\n</preparation_du_sprint>` };
}

export async function runSprintJob(type: (typeof JOB_OF_DOC)[SprintDocKind], sprintId: string, ctx: Ctx, step: Step): Promise<string> {
  const kind = DOC_OF_JOB[type];
  await step('Calcul des chiffres du sprint');
  const call = await sprintDocCall(kind, sprintId, ctx);
  await step(kind === 'compte_rendu' ? 'Rédaction du compte rendu' : 'Rédaction de la préparation');
  const out = await callStructured(call);
  await step('Enregistrement');
  await repo.setDocument(sprintId, kind, repo.newDocument(out.markdown.trim(), ctx.user));
  return kind === 'compte_rendu' ? 'Compte rendu rédigé' : 'Préparation rédigée';
}
