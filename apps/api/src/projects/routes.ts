import { Hono, type Context } from 'hono';
import {
  type PlanningProject,
  applySuggestionsBody,
  cdcMetaSchema,
  createProjectBody,
  createProjectCdcBody,
  createProjectFileBody,
  followProjectBody,
  digestMeetingBody,
  markdownToDoc,
  PROJECT_ITEM_KINDS,
  PROJECT_ITEM_SCHEMAS,
  updateProjectBody,
  ticketCommentBody,
  ticketProcessBody,
  ticketProcessTickets,
  processNextBody,
  processStepOf,
  projectFieldsSchema,
  PROCESS_NEXT,
  TARGET_JALON_LABEL,
  syncProjectCdcsBody,
  type SyncProjectCdcsResult,
  type CdcDocument,
  type ProjectDetail,
  type CdcSummary,
  type Note,
  type ProjectItemKind,
  type ProjectStatus,
  type ProjectPhase,
  type Task,
} from '@samm/shared';
import { userName } from '../auth.js';
import { body, parseBody } from '../lib/http.js';
import { resolveProjectRefs } from '../settings/routes.js';
import { getLists } from '../settings/repo.js';
import { HttpError, newId } from '../lib/util.js';
import * as repo from '../db/repo.js';
import { blobKeys } from '../db/schema.js';
import { blobs } from '../storage/blobs.js';
import { startJob } from '../jobs/runner.js';
import { sectionId } from '../ai/pipeline.js';
import * as pr from './repo.js';
import { projectContextMarkdown } from './ai.js';
import { linkLegacyChefs, resolveProjectChefs, resolveTaskAssignee } from '../users/routes.js';
import * as users from '../users/repo.js';
import { listNotes, putNote } from '../notes/routes.js';
import { listIdeas, putIdea } from '../ideas/routes.js';
import { assertPlannable } from '../sprints/repo.js';
import { syncTmaHours } from '../tma/sync.js';

/** Ticket : responsable rattaché à l'annuaire, sprint en cours ou à venir (s'il change). */
async function resolveTicket(raw: Record<string, unknown>, before: Record<string, unknown> | null, user: string): Promise<Record<string, unknown>> {
  const out = await resolveTaskAssignee(raw, before, user);
  const sprintId = out.sprintId;
  if (typeof sprintId === 'number' && sprintId !== (before?.sprintId ?? null)) await assertPlannable(sprintId);
  return out;
}

/** Phase affichée dans l'en-tête du CDC, déduite du statut du projet. */
const PHASE_OF_STATUS: Partial<Record<ProjectStatus, ProjectPhase>> = {
  cadrage: 'cadrage',
  planifie: 'cadrage',
  en_cours: 'developpement',
  recette: 'testing',
  production: 'production',
  termine: 'termine',
};

async function rawBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const raw = await c.req.json();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  } catch {
    /* corps invalide */
  }
  throw new HttpError(400, 'Corps de requête JSON invalide');
}

function kindParam(raw: string): ProjectItemKind {
  if (!(PROJECT_ITEM_KINDS as string[]).includes(raw)) throw new HttpError(404, 'Type d’élément inconnu');
  return raw as ProjectItemKind;
}

async function cdcsByProject(): Promise<Map<string, CdcSummary[]>> {
  const map = new Map<string, CdcSummary[]>();
  for (const c of await repo.listCdcs()) {
    if (!c.projectId) continue;
    map.set(c.projectId, [...(map.get(c.projectId) ?? []), c]);
  }
  return map;
}

async function projectDetail(id: string) {
  return pr.getProjectDetail(id, (await cdcsByProject()).get(id) ?? []);
}

async function stash(text: string): Promise<string> {
  const key = blobKeys.pendingText(newId());
  await blobs().put(key, text, 'text/plain; charset=utf-8');
  return key;
}

/**
 * Jalon « Fin du projet » à la date de fin visée : créé s'il n'existe pas, déplacé quand la date change (s'il n'est
 * pas encore atteint). Date retirée : le jalon reste, on le supprime à la main si besoin.
 */
async function syncTargetJalon(id: string, targetDate: string, user: string) {
  if (!targetDate) return;
  const jalon = (await pr.listItems(id, 'jalons')).find((j) => j.label === TARGET_JALON_LABEL && !j.done);
  if (jalon) {
    if (jalon.date !== targetDate) await pr.updateItem(id, 'jalons', jalon.id, { date: targetDate }, user);
  } else {
    await pr.createItem(id, 'jalons', parseBody(PROJECT_ITEM_SCHEMAS.jalons, { label: TARGET_JALON_LABEL, date: targetDate }) as Record<string, unknown>, user);
  }
}

/** Routes du module « Projets » (montées sous /api/projects). */
export function projectRoutes() {
  const r = new Hono();

  r.get('/', async (c) => {
    const counts = new Map([...(await cdcsByProject())].map(([k, v]) => [k, v.length]));
    const projects = await pr.listProjects(counts);
    await linkLegacyChefs(projects);
    return c.json(projects);
  });

  /** Frise globale : les jalons et la to-do datée de tous les projets (avant `/:id`). */
  r.get('/jalons', async (c) => {
    const [projects, todos] = await Promise.all([pr.listProjects(), users.listTodos()]);
    await linkLegacyChefs(projects);
    const out: PlanningProject[] = [];
    for (const p of projects) {
      const dated = todos
        .filter((t) => t.projectId === p.id && t.dueDate)
        .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, done: t.done, assigneeId: t.assigneeId }));
      out.push({ id: p.id, chefDeProjetIds: p.chefDeProjetIds, followers: p.followers, name: p.name, status: p.status, health: p.health, startDate: p.startDate, targetDate: p.targetDate, jalons: await pr.listItems(p.id, 'jalons'), todos: dated });
    }
    return c.json(out);
  });

  r.post('/', async (c) => {
    const b = await resolveProjectChefs(await body(c, createProjectBody), null);
    const id = await pr.createProject(b, userName(c));
    await syncTargetJalon(id, b.targetDate, userName(c));
    return c.json(await projectDetail(id), 201);
  });

  r.get('/:id', async (c) => c.json(await projectDetail(c.req.param('id'))));

  r.put('/:id', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, updateProjectBody);
    const before = await pr.requireProject(id);
    const fields = await resolveProjectChefs(b.fields, before);
    await pr.updateProject(id, b.rev, fields, userName(c));
    if (fields.targetDate !== before.targetDate) await syncTargetJalon(id, fields.targetDate, userName(c));
    return c.json(await projectDetail(id));
  });

  /** Suivre un projet (ou ne plus le suivre) : il compte alors parmi « mes projets ». */
  r.put('/:id/suivi', async (c) => {
    const b = await body(c, followProjectBody);
    return c.json({ followers: await pr.setFollower(c.req.param('id'), userName(c), b.follow) });
  });

  r.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const p = await pr.requireProject(id);
    if (p.activeJobId) throw new HttpError(409, 'Une tâche IA est en cours sur ce projet.');
    // Les cahiers des charges ne sont pas supprimés : ils sont simplement détachés.
    for (const cdc of (await cdcsByProject()).get(id) ?? []) await repo.setCdcProject(cdc.id, null);
    // Ni la to-do, ni les notes, ni les idées rattachées : elles restent, hors projet.
    for (const i of (await listIdeas()).filter((i) => i.projectId === id)) await putIdea({ ...i, projectId: '' });
    for (const t of (await users.listTodos()).filter((t) => t.projectId === id)) await users.putTodo({ ...t, projectId: '' });
    for (const u of await users.listUsers()) {
      for (const n of (await listNotes(u.email)).filter((n) => n.projectId === id)) await putNote({ ...n, projectId: '' });
    }
    await pr.deleteProject(id);
    return c.body(null, 204);
  });

  // ---- Éléments rattachés -------------------------------------------------------

  r.post('/:id/items/:kind', async (c) => {
    const kind = kindParam(c.req.param('kind'));
    if (kind === 'files') throw new HttpError(400, 'Utilisez l’envoi de fichier pour ajouter un document.');
    let raw = await resolveProjectRefs(kind, await rawBody(c), null);
    if (kind === 'tasks') raw = await resolveTicket(raw, null, userName(c));
    const b = parseBody(PROJECT_ITEM_SCHEMAS[kind], raw);
    const item = await pr.createItem(c.req.param('id'), kind, b as Record<string, unknown>, userName(c));
    // Ticket rattaché à un ticket Desk : le temps des relevés TMA s'ajoute à son temps passé.
    if (kind === 'tasks' && (item as Task).deskId && (await syncTmaHours((t) => t.id === item.id))) return c.json(await pr.getItem(c.req.param('id'), kind, item.id), 201);
    return c.json(item, 201);
  });

  r.patch('/:id/items/:kind/:itemId', async (c) => {
    const kind = kindParam(c.req.param('kind'));
    const id = c.req.param('id');
    const input = await rawBody(c);
    // Un ticket change de projet (ou sort de tout projet) par `projectId`.
    const target = kind === 'tasks' && typeof input.projectId === 'string' && input.projectId ? input.projectId : id;
    delete input.projectId;
    const before = await pr.getItem(id, kind, c.req.param('itemId'));
    let raw = await resolveProjectRefs(kind, input, before as unknown as Record<string, unknown>);
    if (kind === 'tasks') raw = await resolveTicket(raw, before as unknown as Record<string, unknown>, userName(c));
    const b = parseBody(PROJECT_ITEM_SCHEMAS[kind].partial(), raw);
    // Les valeurs par défaut du schéma ne doivent pas écraser les champs absents de la requête.
    const patch = Object.fromEntries(Object.entries(b as Record<string, unknown>).filter(([k]) => k in raw));
    // Ancien ticket dont le type était dans le titre : un nouveau titre ne doit pas lui faire perdre son type.
    if (kind === 'tasks' && 'title' in patch && !('type' in patch)) patch.type = (before as Task).type;
    if (target !== id) {
      await pr.moveTicket(id, c.req.param('itemId'), target, userName(c));
      if (!Object.keys(patch).length) return c.json(await pr.getItem(target, kind, c.req.param('itemId')));
    }
    const item = await pr.updateItem(target, kind, c.req.param('itemId'), patch, userName(c));
    // Numéro Desk ou temps passé modifié : la part du prestataire (relevés TMA) est recalculée.
    if (kind === 'tasks' && ('deskId' in patch || 'spentHours' in patch) && (await syncTmaHours((t) => t.id === item.id))) {
      return c.json(await pr.getItem(target, kind, item.id));
    }
    return c.json(item);
  });

  /** Process complet : les tickets des étapes choisies (cadrage, dev, recette, correctif, MEP), créés d'un coup et dans l'ordre. */
  r.post('/:id/tickets/process', async (c) => {
    const id = c.req.param('id');
    const user = userName(c);
    const b = await body(c, ticketProcessBody);
    const project = await pr.requireProject(id);
    const { steps, complement, ...common } = b;
    // Responsable et sprint vérifiés une fois, avant toute création.
    const shared = await resolveTicket({ ...common, title: '-' }, null, user);
    // Le premier ticket est à faire, les suivants en attente du précédent.
    for (const t of ticketProcessTickets(project.name, steps, complement)) {
      await pr.createItem(id, 'tasks', parseBody(PROJECT_ITEM_SCHEMAS.tasks, { ...shared, ...t }) as Record<string, unknown>, user);
    }
    return c.json(await projectDetail(id), 201);
  });

  /**
   * Suite du process, validée par l'utilisateur quand un ticket du process est terminé : le projet passe au statut choisi
   * et le ticket de l'étape suivante (le plus ancien non terminé) passe « À faire » s'il était en attente.
   */
  r.post('/:id/tickets/:itemId/suite', async (c) => {
    const id = c.req.param('id');
    const user = userName(c);
    const { projectStatus } = await body(c, processNextBody);
    const ticket = await pr.getItem(id, 'tasks', c.req.param('itemId'));
    const step = processStepOf(ticket.type);
    if (!step) throw new HttpError(400, 'Ce ticket ne fait pas partie d’un process (cadrage, dev, recette, correctif, MEP).');
    const project = await pr.requireProject(id);
    const next = PROCESS_NEXT[step].nextStep;
    const target = next
      ? (await pr.listItems(id, 'tasks')).filter((t) => !t.done && processStepOf(t.type) === next).sort((a, b) => a.number - b.number)[0]
      : undefined;
    if (target?.status === 'attente') await pr.updateItem(id, 'tasks', target.id, { status: 'a_faire' }, user);
    if (projectStatus && projectStatus !== project.status) {
      await pr.updateProject(id, project.rev, { ...projectFieldsSchema.parse(project), status: projectStatus }, user);
    }
    return c.json({ project: await projectDetail(id), started: target && target.status === 'attente' ? { id: target.id, number: target.number, title: target.title, type: target.type } : null });
  });

  // ---- Notes de suivi d'un ticket (hors champs du ticket) ----------------------------------

  r.post('/:id/tickets/:itemId/notes', async (c) => {
    const { text } = await body(c, ticketCommentBody);
    const user = userName(c);
    const comments = await pr.addTicketComment(c.req.param('id'), c.req.param('itemId'), text, user, c.get('user').name || user);
    return c.json(comments, 201);
  });

  r.put('/:id/tickets/:itemId/notes/:noteId', async (c) => {
    const { text } = await body(c, ticketCommentBody);
    return c.json(await pr.changeTicketComment(c.req.param('id'), c.req.param('itemId'), c.req.param('noteId'), text, userName(c)));
  });

  r.delete('/:id/tickets/:itemId/notes/:noteId', async (c) => {
    return c.json(await pr.changeTicketComment(c.req.param('id'), c.req.param('itemId'), c.req.param('noteId'), null, userName(c)));
  });

  r.delete('/:id/items/:kind/:itemId', async (c) => {
    const kind = kindParam(c.req.param('kind'));
    await pr.deleteItem(c.req.param('id'), kind, c.req.param('itemId'), userName(c));
    return c.body(null, 204);
  });

  // ---- Pièces jointes -------------------------------------------------------------

  r.post('/:id/files', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, createProjectFileBody);
    const { contentType, size, ...input } = b;
    const file = await pr.createItem(id, 'files', input, userName(c), { silent: true, extra: { contentType, size, uploaded: false } });
    const upload = await blobs().uploadUrl(pr.projectBlobKeys.file(id, file.id), contentType, size);
    return c.json({ file, upload }, 201);
  });

  r.post('/:id/files/:fileId/confirm', async (c) => {
    const id = c.req.param('id');
    const fileId = c.req.param('fileId');
    const project = await pr.requireProject(id);
    const file = await pr.getItem(id, 'files', fileId);
    if (!(await blobs().exists(pr.projectBlobKeys.file(id, fileId)))) throw new HttpError(400, 'Le fichier n’a pas été reçu. Réessayez l’envoi.');
    if (!file.uploaded) {
      await pr.setItemFields(id, 'files', fileId, { uploaded: true });
      await pr.logActivity(id, project.name, userName(c), `a déposé le document « ${file.name} »`);
      await pr.refreshStats(id, userName(c));
    }
    return c.json({ ...file, uploaded: true });
  });

  r.get('/:id/files/:fileId/download', async (c) => {
    const id = c.req.param('id');
    const file = await pr.getItem(id, 'files', c.req.param('fileId'));
    const url = await blobs().downloadUrl(pr.projectBlobKeys.file(id, file.id), { fileName: file.name, expiresIn: 300 });
    return c.json({ url, fileName: file.name });
  });

  // ---- Journal : transcription d'origine, propositions de l'assistant -------------

  r.get('/:id/notes/:noteId/source', async (c) => {
    const id = c.req.param('id');
    const note = await pr.getItem(id, 'notes', c.req.param('noteId'));
    const buf = note.hasSource ? await blobs().get(pr.projectBlobKeys.noteSource(id, note.id)) : null;
    if (!buf) throw new HttpError(404, 'Aucune transcription conservée pour cette note.');
    return c.json({ text: buf.toString('utf8') });
  });

  r.post('/:id/notes/:noteId/suggestions', async (c) => {
    const id = c.req.param('id');
    const user = userName(c);
    const b = await body(c, applySuggestionsBody);
    const project = await pr.requireProject(id);
    const note: Note = await pr.getItem(id, 'notes', c.req.param('noteId'));
    const s = note.suggestions;
    if (!s) throw new HttpError(400, 'Cette note ne contient pas de propositions.');
    const created: string[] = [];
    const decide = <T extends { state: string }>(list: T[], accepted: number[], create: (x: T) => Promise<void>) =>
      Promise.all(
        list.map(async (x, i) => {
          if (x.state !== 'proposee') return x;
          if (accepted.includes(i)) {
            await create(x);
            return { ...x, state: 'acceptee' as const };
          }
          return { ...x, state: 'refusee' as const };
        }),
      );
    const tasks = await decide(s.tasks, b.tasks, async (t) => {
      const who = await resolveTaskAssignee({ assignee: t.assignee }, null, user);
      await pr.createItem(id, 'tasks', parseBody(PROJECT_ITEM_SCHEMAS.tasks, { title: t.title, ...who, dueDate: t.dueDate, priority: t.priority, details: `Issue du compte rendu « ${note.title} »` }), user, { silent: true });
      created.push('ticket');
    });
    const jalons = await decide(s.jalons, b.jalons, async (j) => {
      // Un jalon existant du même nom est déplacé plutôt que dupliqué.
      const existing = (await pr.listItems(id, 'jalons')).find((x) => x.label.trim().toLowerCase() === j.label.trim().toLowerCase());
      if (existing) await pr.updateItem(id, 'jalons', existing.id, { date: j.date || existing.date }, user);
      else await pr.createItem(id, 'jalons', { label: j.label, date: j.date }, user, { silent: true });
      created.push('jalon');
    });
    const risks = await decide(s.risks, b.risks, async (x) => {
      await pr.createItem(id, 'risks', { title: x.title, probability: x.probability, impact: x.impact, mitigation: x.mitigation }, user, { silent: true });
      created.push('risque');
    });
    const ticketUpdates = await decide(s.ticketUpdates ?? [], b.ticketUpdates, async (u) => {
      // Ticket supprimé ou déjà terminé depuis l'analyse : la proposition est sans objet.
      const t = await pr.getItem(id, 'tasks', u.ticketId).catch(() => null);
      if (!t) return;
      const patch = { ...(u.status ? { status: u.status } : {}), ...(u.dueDate ? { dueDate: u.dueDate } : {}), ...(u.priority ? { priority: u.priority } : {}) };
      await pr.updateItem(id, 'tasks', u.ticketId, patch, user);
      created.push('mise à jour');
    });
    await pr.setItemFields(id, 'notes', note.id, { suggestions: { ...s, tasks, jalons, risks, ticketUpdates } });
    if (created.length) {
      await pr.logActivity(id, project.name, user, `a validé ${created.length} proposition${created.length > 1 ? 's' : ''} de l’assistant (« ${note.title} »)`);
    }
    await pr.refreshStats(id, user);
    return c.json(await projectDetail(id));
  });

  // ---- Assistant IA -------------------------------------------------------------------

  r.post('/:id/digest', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, digestMeetingBody);
    await pr.requireProject(id);
    return c.json(await startJob('project_digest', id, userName(c), { textKey: await stash(b.text), title: b.title, date: b.date }), 202);
  });

  r.post('/:id/report', async (c) => {
    const id = c.req.param('id');
    await pr.requireProject(id);
    return c.json(await startJob('project_report', id, userName(c), {}), 202);
  });

  // ---- Cahiers des charges ---------------------------------------------------------------

  /** Report de la fiche projet (description, sections) dans les CDC choisis : une nouvelle version par CDC. */
  r.post('/:id/cdcs/sync', async (c) => {
    const id = c.req.param('id');
    const user = userName(c);
    const b = await body(c, syncProjectCdcsBody);
    const project = await projectDetail(id);
    const res: SyncProjectCdcsResult = { updated: [], skipped: [] };
    for (const cdcId of b.cdcIds) {
      const cdc = project.cdcs.find((x) => x.id === cdcId);
      if (!cdc) {
        res.skipped.push({ id: cdcId, title: cdcId, reason: 'n’est pas rattaché à ce projet' });
        continue;
      }
      const full = await repo.requireCdc(cdcId);
      if (full.activeJobId) {
        res.skipped.push({ id: cdcId, title: cdc.title, reason: 'une tâche IA est en cours' });
        continue;
      }
      const { document } = await repo.getVersion(cdcId, full.currentVersion.seq);
      const next = applyProjectToCdc(document, project, b);
      const version = await repo.saveVersion(cdcId, full.currentVersion.seq, next, { user, origin: 'manuel', comment: 'Mis à jour depuis la fiche du projet' });
      res.updated.push({ id: cdcId, title: cdc.title, version: version.label });
    }
    if (res.updated.length) await pr.logActivity(id, project.name, user, `a reporté la fiche du projet dans ${res.updated.length} cahier${res.updated.length > 1 ? 's' : ''} des charges`);
    return c.json(res);
  });

  r.post('/:id/cdcs', async (c) => {
    const id = c.req.param('id');
    const user = userName(c);
    const b = await body(c, createProjectCdcBody);
    const project = await projectDetail(id);
    const presta = b.prestationId ? project.items.prestations.find((x) => x.id === b.prestationId) : undefined;
    if (b.prestationId && !presta) throw new HttpError(404, 'Prestation introuvable');
    const pending = project.items.jalons.filter((j) => !j.done);
    const document: CdcDocument = {
      meta: cdcMetaSchema.parse({
        title: b.title || (presta ? `${project.name} — ${presta.objet}` : project.name),
        status: 'brouillon',
        projet: project.name,
        prestataire: presta?.prestataire ?? (project.stats.prestataires.length === 1 ? project.stats.prestataires[0] : ''),
        phase: PHASE_OF_STATUS[project.status] ?? null,
        estimationJours: presta?.chargeJours ?? null,
        jalons: pending.slice(0, 30).map((j) => ({ id: sectionId(), label: j.label, date: j.date })),
      }),
      sections: cdcSectionsFromProject(project),
    };
    document.meta.title = document.meta.title.slice(0, 300);
    const { id: cdcId } = await repo.createCdc(document, user, id);
    if (presta && !presta.cdcId) await pr.updateItem(id, 'prestations', presta.id, { cdcId }, user);
    await pr.logActivity(id, project.name, user, `a créé le cahier des charges « ${document.meta.title} »`);

    let job = null;
    if (b.withAi) {
      const context = projectContextMarkdown(project, { prestationId: b.prestationId, noteIds: b.noteIds }, await getLists());
      job = await startJob('create_from_transcript', cdcId, user, {
        contextKey: await stash(context),
        ...(b.transcript.trim() ? { textKey: await stash(b.transcript) } : {}),
        title: b.title,
      });
    }
    return c.json({ id: cdcId, job }, 201);
  });

  return r;
}

/**
 * Nouvelle version d'un CDC avec la fiche projet : Contexte = description (et la section « Contexte » du projet) si
 * elle a changé ; chaque section choisie remplace la section de même titre (ou de son ancien titre), sinon s'ajoute
 * avant les annexes. Les autres sections du CDC ne bougent pas ; aucune n'est supprimée.
 */
export function applyProjectToCdc(
  doc: CdcDocument,
  project: Pick<ProjectDetail, 'description' | 'sections'>,
  change: { description: boolean; sectionIds: string[]; previousTitles: Record<string, string> },
): CdcDocument {
  let sections = [...doc.sections];
  if (change.description) {
    const md = [project.description.trim(), ...project.sections.filter((s) => plainTitle(s.title) === 'contexte').map((s) => s.content.trim())].filter(Boolean).join('\n\n');
    sections = sections.map((s) => (s.kind === 'contexte' ? { ...s, content: markdownToDoc(md) } : s));
  }
  for (const sec of project.sections.filter((s) => change.sectionIds.includes(s.id))) {
    const t = plainTitle(sec.title);
    if (t === 'contexte') continue;
    const titles = [t, plainTitle(change.previousTitles[sec.id] ?? '')].filter(Boolean);
    const content = markdownToDoc(sec.content.trim());
    const i = sections.findIndex((s) => (t === 'annexes' ? s.kind === 'annexes' : s.kind === 'standard' && titles.includes(plainTitle(s.title))));
    if (i >= 0) sections[i] = { ...sections[i]!, title: t === 'annexes' ? sections[i]!.title : sec.title.trim(), content };
    else {
      const added = { id: sectionId(), kind: t === 'annexes' ? ('annexes' as const) : ('standard' as const), title: t === 'annexes' ? 'Annexes' : sec.title.trim(), content };
      const at = sections.findIndex((s) => s.kind === 'annexes');
      if (t === 'annexes' || at < 0) sections.push(added);
      else sections.splice(at, 0, added);
    }
  }
  return { ...doc, sections };
}

/** Titre comparé sans casse ni accents (« Contexte », « ANNEXES »…). */
const plainTitle = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/**
 * Sections d'un nouveau CDC, reprises de la fiche projet (modifiables ensuite) : la description fait le Contexte,
 * chaque section du projet devient une section du CDC, dans le même ordre. Une section du projet nommée « Contexte »
 * complète le Contexte, une section « Annexes » devient les annexes (en dernier).
 */
export function cdcSectionsFromProject(project: Pick<ProjectDetail, 'description' | 'sections'>): CdcDocument['sections'] {
  const contexte = [project.description.trim()];
  const annexes: string[] = [];
  const standard: CdcDocument['sections'] = [];
  for (const sec of project.sections) {
    const md = sec.content.trim();
    const t = plainTitle(sec.title);
    if (t === 'contexte') contexte.push(md);
    else if (t === 'annexes') annexes.push(md);
    else standard.push({ id: sectionId(), kind: 'standard', title: sec.title.trim(), content: markdownToDoc(md) });
  }
  return [
    { id: sectionId(), kind: 'contexte', title: 'Contexte', content: markdownToDoc(contexte.filter(Boolean).join('\n\n')) },
    ...standard,
    ...(annexes.some(Boolean) ? [{ id: sectionId(), kind: 'annexes' as const, title: 'Annexes', content: markdownToDoc(annexes.filter(Boolean).join('\n\n')) }] : []),
  ];
}
