import { Hono } from 'hono';
import {
  applySuggestionsBody,
  cdcMetaSchema,
  createProjectBody,
  createProjectCdcBody,
  createProjectFileBody,
  digestMeetingBody,
  emptyDoc,
  PROJECT_ITEM_KINDS,
  PROJECT_ITEM_SCHEMAS,
  updateProjectBody,
  type CdcDocument,
  type CdcSummary,
  type Note,
  type ProjectItemKind,
  type ProjectStatus,
  type ProjectPhase,
} from '@samm/shared';
import { userName } from '../auth.js';
import { body } from '../lib/http.js';
import { HttpError, newId } from '../lib/util.js';
import * as repo from '../db/repo.js';
import { blobKeys } from '../db/schema.js';
import { blobs } from '../storage/blobs.js';
import { startJob } from '../jobs/runner.js';
import { sectionId } from '../ai/pipeline.js';
import * as pr from './repo.js';
import { projectContextMarkdown } from './ai.js';

/** Phase affichée dans l'en-tête du CDC, déduite du statut du projet. */
const PHASE_OF_STATUS: Partial<Record<ProjectStatus, ProjectPhase>> = {
  cadrage: 'cadrage',
  en_cours: 'developpement',
  recette: 'testing',
  production: 'production',
  termine: 'termine',
};

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

/** Routes du module « Projets » (montées sous /api/projects). */
export function projectRoutes() {
  const r = new Hono();

  r.get('/', async (c) => {
    const counts = new Map([...(await cdcsByProject())].map(([k, v]) => [k, v.length]));
    return c.json(await pr.listProjects(counts));
  });

  r.post('/', async (c) => {
    const b = await body(c, createProjectBody);
    const id = await pr.createProject(b, userName(c));
    return c.json(await projectDetail(id), 201);
  });

  r.get('/:id', async (c) => c.json(await projectDetail(c.req.param('id'))));

  r.put('/:id', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, updateProjectBody);
    await pr.updateProject(id, b.rev, b.fields, userName(c));
    return c.json(await projectDetail(id));
  });

  r.delete('/:id', async (c) => {
    const id = c.req.param('id');
    const p = await pr.requireProject(id);
    if (p.activeJobId) throw new HttpError(409, 'Une tâche IA est en cours sur ce projet.');
    // Les cahiers des charges ne sont pas supprimés : ils sont simplement détachés.
    for (const cdc of (await cdcsByProject()).get(id) ?? []) await repo.setCdcProject(cdc.id, null);
    await pr.deleteProject(id);
    return c.body(null, 204);
  });

  // ---- Éléments rattachés -------------------------------------------------------

  r.post('/:id/items/:kind', async (c) => {
    const kind = kindParam(c.req.param('kind'));
    if (kind === 'files') throw new HttpError(400, 'Utilisez l’envoi de fichier pour ajouter un document.');
    const b = await body(c, PROJECT_ITEM_SCHEMAS[kind]);
    return c.json(await pr.createItem(c.req.param('id'), kind, b as Record<string, unknown>, userName(c)), 201);
  });

  r.patch('/:id/items/:kind/:itemId', async (c) => {
    const kind = kindParam(c.req.param('kind'));
    const b = await body(c, PROJECT_ITEM_SCHEMAS[kind].partial());
    // Les valeurs par défaut du schéma ne doivent pas écraser les champs absents de la requête.
    const raw = (await c.req.json()) as Record<string, unknown>;
    const patch = Object.fromEntries(Object.entries(b as Record<string, unknown>).filter(([k]) => k in raw));
    return c.json(await pr.updateItem(c.req.param('id'), kind, c.req.param('itemId'), patch, userName(c)));
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
      await pr.createItem(id, 'tasks', { title: t.title, assignee: t.assignee, dueDate: t.dueDate, priority: t.priority, details: `Issue du compte rendu « ${note.title} »` }, user, { silent: true });
      created.push('tâche');
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
    await pr.setItemFields(id, 'notes', note.id, { suggestions: { tasks, jalons, risks } });
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
      sections: [{ id: sectionId(), kind: 'contexte', title: 'Contexte', content: emptyDoc() }],
    };
    document.meta.title = document.meta.title.slice(0, 300);
    const { id: cdcId } = await repo.createCdc(document, user, id);
    if (presta && !presta.cdcId) await pr.updateItem(id, 'prestations', presta.id, { cdcId }, user);
    await pr.logActivity(id, project.name, user, `a créé le cahier des charges « ${document.meta.title} »`);

    let job = null;
    if (b.withAi) {
      const context = projectContextMarkdown(project, { prestationId: b.prestationId, noteIds: b.noteIds });
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
