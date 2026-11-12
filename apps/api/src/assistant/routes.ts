/**
 * Assistant (monté sous /api/assistant) : une question, une réponse, sur action explicite de l'utilisateur.
 * Appel synchrone au modèle rapide (la réponse doit tenir dans le délai de l'API) ; la conversation est tenue par le
 * navigateur et rien n'est enregistré, hors le suivi de consommation.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import {
  ASSISTANT_HISTORY_CHARS,
  assistantActionOutputSchema,
  assistantAskBody,
  parisDay,
  themeAssistant,
  nameKey,
  type HubUser,
  type AssistantAction,
  type AssistantAnswer,
  type AssistantMessage,
  type ProjectSummary,
} from '@samm/shared';
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
import { assistantSystem } from './prompts.js';

export const assistantOutputSchema = z.object({
  answer: z.string().describe('Réponse en Markdown'),
  followUps: z.array(z.string()).describe('0 à 3 questions de relance'),
  actions: z.array(assistantActionOutputSchema).describe('Éléments à créer proposés à l’utilisateur (texte long ou demande explicite), sinon liste vide'),
});
export type AssistantOutput = z.infer<typeof assistantOutputSchema>;

/** Au plus 10 propositions par réponse. */
const MAX_ACTIONS = 10;

/**
 * Propositions de l'IA ramenées à ce que le hub accepte : projet existant (sinon aucun), date valide, intitulé non vide,
 * jalon seulement avec un projet, type de ticket du paramétrage, responsable actif.
 * Le nom du projet est recopié par le code.
 */
export function sanitizeActions(
  raw: AssistantOutput['actions'],
  projects: ProjectSummary[],
  refs: { ticketTypes?: string[]; users?: HubUser[] } = {},
): AssistantAction[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  return raw
    .map((a) => {
      const project = byId.get(a.projectId.trim().replace(/^\/?projets\//, ''));
      const type = a.kind === 'ticket' ? refs.ticketTypes?.find((t) => nameKey(t) === nameKey(a.ticketType ?? '')) : undefined;
      // Le type est un champ du ticket : un préfixe « [DEV] - » ajouté par l'IA au titre est retiré.
      const bare = a.title.trim().replace(/^\[[^\]]*\]\s*-\s*/, type ? '' : '$&');
      const title = type ? bare || project?.name || type : bare;
      const assignee = a.kind !== 'jalon' ? refs.users?.find((u) => u.active && u.email === (a.assigneeId ?? '').trim().toLowerCase()) : undefined;
      return {
        kind: a.kind,
        title: title.trim().slice(0, 300),
        ticketType: type ?? '',
        details: a.details.trim().slice(0, 4000),
        projectId: project?.id ?? '',
        projectName: project?.name ?? '',
        dueDate: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate.trim()) ? a.dueDate.trim() : '',
        priority: a.priority,
        assigneeId: assignee?.email ?? '',
        reason: a.reason.trim().slice(0, 300),
      };
    })
    .filter((a) => a.title && (a.kind !== 'jalon' || a.projectId))
    .slice(0, MAX_ACTIONS);
}

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
  return history.map((m) => `${m.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${m.content.length > ASSISTANT_HISTORY_CHARS ? `${m.content.slice(0, ASSISTANT_HISTORY_CHARS)}…` : m.content}`).join('\n\n');
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
      // Le personnage suit le thème de l'utilisateur (Mordor : Saroumane).
      system: assistantSystem(themeAssistant(data.users.find((u) => u.email === user)?.theme)),
      context: globalContext(data),
      input,
      schema: assistantOutputSchema,
      maxTokens: 4000,
      effort: 'low',
      timeoutMs: TIMEOUT_MS,
      ctx: { user, cdcId: '' },
    });
    const res: AssistantAnswer = {
      answer: out.answer.trim(),
      followUps: out.followUps.map((q) => q.trim()).filter(Boolean).slice(0, 3),
      projects: focus.map((p) => ({ id: p.id, name: p.name })),
      actions: sanitizeActions(out.actions, data.projects, { ticketTypes: data.lists.ticketTypes, users: data.users }),
    };
    return c.json(res);
  });

  return r;
}
