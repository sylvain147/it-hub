/**
 * Compte rendu de sprint rédigé par l'IA (sur demande uniquement).
 *
 * Économie : le modèle de rédaction ne reçoit que les chiffres calculés par le code (quelques Ko) ;
 * ni les descriptions ni les commentaires des tickets ne sont lus dans Jira.
 */
import { buildSprintReport, sprintReportToMarkdown } from '@samm/shared';
import { callStructured } from '../ai/llm.js';
import * as repo from './repo.js';
import { SPRINT_REVIEW_SYSTEM } from './prompts.js';
import { sprintReviewSchema } from './ai-schemas.js';

type Ctx = { user: string; cdcId: string };
type Step = (s: string) => Promise<void>;

export async function runJiraJob(sprintId: string, ctx: Ctx, step: Step): Promise<string> {
  await step('Calcul des chiffres du sprint');
  const { snapshot } = await repo.getSprint(sprintId);
  const report = buildSprintReport(snapshot);
  await step('Rédaction du compte rendu');
  const out = await callStructured({
    tier: 'smart',
    operation: 'jira_compte_rendu',
    system: SPRINT_REVIEW_SYSTEM,
    input: `<chiffres_du_sprint>\n${sprintReportToMarkdown(report)}\n</chiffres_du_sprint>`,
    schema: sprintReviewSchema,
    maxTokens: 4000,
    effort: 'medium',
    ctx,
  });
  await step('Enregistrement');
  await repo.setCompteRendu(sprintId, repo.newCompteRendu(out.markdown.trim(), ctx.user));
  return 'Compte rendu rédigé';
}
