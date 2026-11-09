/**
 * Assistant (monté sous /api/assistant) : une question, une réponse, sur action explicite de l'utilisateur.
 * Appel synchrone au modèle rapide (la réponse doit tenir dans le délai de l'API) ; la conversation est tenue par le
 * navigateur et rien n'est enregistré, hors le suivi de consommation.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { assistantAskBody, parisDay, type AssistantAnswer, type AssistantMessage } from '@samm/shared';
import { userName } from '../auth.js';
import { assertBudget, callStructured } from '../ai/llm.js';
import { body } from '../lib/http.js';
import { getLists } from '../settings/repo.js';
import * as pr from '../projects/repo.js';
import { reportInput } from '../projects/ai.js';
import * as sprints from '../sprints/repo.js';
import * as users from '../users/repo.js';
import { listNotes } from '../notes/routes.js';
import { linkLegacyChefs } from '../users/routes.js';
import { globalContext, mentionedProjects, type AssistantData } from './context.js';
import { ASSISTANT_SYSTEM } from './prompts.js';

export const assistantOutputSchema = z.object({
  answer: z.string().describe('Réponse en Markdown'),
  followUps: z.array(z.string()).describe('0 à 3 questions de relance'),
});
export type AssistantOutput = z.infer<typeof assistantOutputSchema>;

/** Délai laissé au modèle : la réponse doit revenir avant la limite de l'API (29 s). */
const TIMEOUT_MS = 25_000;

export async function loadAssistantData(email: string): Promise<AssistantData> {
  const [lists, all, projects, tickets, sprintItems, todos, notes] = await Promise.all([
    getLists(),
    users.listUsers(),
    pr.listProjects(),
    pr.listTickets(),
    sprints.listSprintItems(),
    users.listTodos(),
    listNotes(email),
  ]);
  await linkLegacyChefs(projects);
  const jalons = (await Promise.all(projects.map(async (p) => (await pr.listItems(p.id, 'jalons')).map((item) => ({ projectId: p.id, item }))))).flat();
  return {
    me: { email, name: all.find((u) => u.email === email)?.name ?? email },
    today: parisDay(Date.now()),
    lists,
    users: all,
    projects,
    jalons,
    tickets,
    sprints: sprintItems.map(sprints.toSprint),
    // La to-do personnelle des autres n'est pas envoyée, même à qui a le droit de la voir.
    todos: todos.filter((t) => t.assigneeId === email || t.createdBy === email || !!t.projectId),
    notes: notes.filter((n) => !n.archived),
  };
}

function conversation(history: AssistantMessage[]): string {
  return history.map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.content.length > 2000 ? `${m.content.slice(0, 2000)}…` : m.content}`).join('\n\n');
}

export function assistantRoutes() {
  const r = new Hono();

  r.post('/', async (c) => {
    const user = userName(c);
    const { question, history } = await body(c, assistantAskBody);
    await assertBudget();
    const data = await loadAssistantData(user);
    const focus = mentionedProjects(data.projects, question, history);
    const details = await Promise.all(focus.map(async (p) => `# Projet ${p.name} (/projets/${p.id})\n\n${reportInput(await pr.getProjectDetail(p.id, []), data.lists, data.today)}`));
    const input = [
      details.length && `<projets_detailles>\n${details.join('\n\n')}\n</projets_detailles>`,
      history.length && `<conversation>\n${conversation(history)}\n</conversation>`,
      `<question>\n${question}\n</question>`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = await callStructured({
      tier: 'fast',
      operation: 'assistant',
      system: ASSISTANT_SYSTEM,
      context: globalContext(data),
      input,
      schema: assistantOutputSchema,
      maxTokens: 3000,
      effort: 'low',
      timeoutMs: TIMEOUT_MS,
      ctx: { user, cdcId: '' },
    });
    const res: AssistantAnswer = {
      answer: out.answer.trim(),
      followUps: out.followUps.map((q) => q.trim()).filter(Boolean).slice(0, 3),
      projects: focus.map((p) => ({ id: p.id, name: p.name })),
    };
    return c.json(res);
  });

  return r;
}
