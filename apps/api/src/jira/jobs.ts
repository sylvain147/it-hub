/**
 * Documents de sprint rédigés par l'IA (sur demande uniquement) : compte rendu et préparation.
 *
 * Économie : le modèle de rédaction ne reçoit que les éléments calculés par le code (quelques Ko) ;
 * ni les descriptions ni les commentaires des tickets ne sont lus dans Jira.
 */
import { buildSprintReport, sprintPreparationToMarkdown, sprintReportToMarkdown, type SprintDocKind } from '@samm/shared';
import { HttpError } from '../lib/util.js';
import { callStructured } from '../ai/llm.js';
import * as repo from './repo.js';
import { SPRINT_PREPARATION_SYSTEM, SPRINT_REVIEW_SYSTEM } from './prompts.js';
import { sprintDocSchema } from './ai-schemas.js';
import { sprintPreparation } from './views.js';

type Ctx = { user: string; cdcId: string };
type Step = (s: string) => Promise<void>;

export const JOB_OF_DOC = { compte_rendu: 'jira_sprint_review', preparation: 'jira_sprint_preparation' } as const satisfies Record<SprintDocKind, string>;

export async function runJiraJob(type: (typeof JOB_OF_DOC)[SprintDocKind], sprintId: string, ctx: Ctx, step: Step): Promise<string> {
  await step('Calcul des chiffres du sprint');
  const { snapshot } = await repo.getSprint(sprintId);
  if (type === 'jira_sprint_review') {
    const report = buildSprintReport(snapshot);
    await step('Rédaction du compte rendu');
    const out = await callStructured({
      tier: 'smart',
      operation: 'jira_compte_rendu',
      system: SPRINT_REVIEW_SYSTEM,
      input: `<chiffres_du_sprint>\n${sprintReportToMarkdown(report)}\n</chiffres_du_sprint>`,
      schema: sprintDocSchema,
      maxTokens: 4000,
      effort: 'medium',
      ctx,
    });
    await step('Enregistrement');
    await repo.setDocument(sprintId, 'compte_rendu', repo.newDocument(out.markdown.trim(), ctx.user));
    return 'Compte rendu rédigé';
  }
  const prep = await sprintPreparation(snapshot.sprint);
  if (!prep) throw new HttpError(400, 'Importez d’abord les tickets depuis Jira.');
  await step('Rédaction de la préparation');
  const out = await callStructured({
    tier: 'smart',
    operation: 'jira_preparation',
    system: SPRINT_PREPARATION_SYSTEM,
    input: `<preparation_du_sprint>\n${sprintPreparationToMarkdown(prep)}\n</preparation_du_sprint>`,
    schema: sprintDocSchema,
    maxTokens: 4000,
    effort: 'medium',
    ctx,
  });
  await step('Enregistrement');
  await repo.setDocument(sprintId, 'preparation', repo.newDocument(out.markdown.trim(), ctx.user));
  return 'Préparation rédigée';
}
