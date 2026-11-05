import { Hono } from 'hono';
import {
  listSettingsSchema,
  mergePrestataireBody,
  nameKey,
  prestataireContactInputSchema,
  prestataireInputSchema,
  type Contact,
  type Prestataire,
  type PrestataireUsage,
  type SettingsResponse,
} from '@samm/shared';
import { userName } from '../auth.js';
import { body } from '../lib/http.js';
import { HttpError, newId, nowIso } from '../lib/util.js';
import * as pr from '../projects/repo.js';
import * as st from './repo.js';

async function assertUniqueName(name: string, exceptId?: string) {
  const dup = (await st.listPrestataires()).find((p) => p.id !== exceptId && nameKey(p.name) === nameKey(name));
  if (dup) throw new HttpError(409, `Le prestataire « ${dup.name} » existe déjà${dup.active ? '' : ' (archivé)'}.`);
}

/** Recopie le nom d'un prestataire dans les prestations et intervenants qui y sont rattachés. */
async function syncPrestataireName(p: Prestataire, user: string) {
  const prestations = (await pr.listItemsAllProjects('prestations')).filter((x) => x.item.prestataireId === p.id && x.item.prestataire !== p.name);
  await pr.syncItems('prestations', prestations.map((x) => ({ projectId: x.projectId, itemId: x.item.id, fields: { prestataire: p.name } })), user);
  const contacts = (await pr.listItemsAllProjects('contacts')).filter((x) => x.item.prestataireId === p.id && x.item.organisation !== p.name);
  await pr.syncItems('contacts', contacts.map((x) => ({ projectId: x.projectId, itemId: x.item.id, fields: { organisation: p.name } })), user);
}

/** Recopie un contact du carnet dans les projets où il est intervenant (le rôle et les notes du projet sont conservés). */
async function syncDirectoryContact(p: Prestataire, contactId: string, user: string) {
  const c = p.contacts.find((x) => x.id === contactId);
  if (!c) return;
  const linked = (await pr.listItemsAllProjects('contacts')).filter((x) => x.item.directoryContactId === contactId);
  await pr.syncItems(
    'contacts',
    linked.map((x) => ({ projectId: x.projectId, itemId: x.item.id, fields: { name: c.name, email: c.email, phone: c.phone, organisation: p.name, prestataireId: p.id } })),
    user,
  );
}

/** Routes du paramétrage (montées sous /api/settings). */
export function settingsRoutes() {
  const r = new Hono();

  r.get('/', async (c) => {
    const res: SettingsResponse = { lists: await st.getLists(), prestataires: await st.listPrestataires() };
    return c.json(res);
  });

  r.put('/lists', async (c) => {
    const b = await body(c, listSettingsSchema);
    return c.json(await st.putLists(b, userName(c)));
  });

  r.get('/usage', async (c) => {
    const prestations = await pr.listItemsAllProjects('prestations');
    const usage: PrestataireUsage = { prestations: {}, unlinked: [] };
    const unlinked = new Map<string, { name: string; prestations: number }>();
    for (const { item } of prestations) {
      if (item.prestataireId) usage.prestations[item.prestataireId] = (usage.prestations[item.prestataireId] ?? 0) + 1;
      else {
        const u = unlinked.get(nameKey(item.prestataire)) ?? { name: item.prestataire.trim(), prestations: 0 };
        u.prestations++;
        unlinked.set(nameKey(item.prestataire), u);
      }
    }
    usage.unlinked = [...unlinked.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return c.json(usage);
  });

  // ---- Prestataires -----------------------------------------------------------------

  r.post('/prestataires', async (c) => {
    const b = await body(c, prestataireInputSchema);
    await assertUniqueName(b.name);
    const now = nowIso();
    const user = userName(c);
    return c.json(await st.putPrestataire({ ...b, id: newId(), contacts: [], createdAt: now, createdBy: user, updatedAt: now, updatedBy: user }), 201);
  });

  r.put('/prestataires/:id', async (c) => {
    const b = await body(c, prestataireInputSchema);
    const before = await st.getPrestataire(c.req.param('id'));
    if (nameKey(b.name) !== nameKey(before.name)) await assertUniqueName(b.name, before.id);
    const user = userName(c);
    const p = await st.putPrestataire({ ...before, ...b, updatedAt: nowIso(), updatedBy: user });
    if (p.name !== before.name) await syncPrestataireName(p, user);
    return c.json(p);
  });

  r.delete('/prestataires/:id', async (c) => {
    const p = await st.getPrestataire(c.req.param('id'));
    const used =
      (await pr.listItemsAllProjects('prestations')).some((x) => x.item.prestataireId === p.id) ||
      (await pr.listItemsAllProjects('contacts')).some((x) => x.item.prestataireId === p.id);
    if (used) throw new HttpError(409, `« ${p.name} » est utilisé dans des projets : archivez-le plutôt (il ne sera plus proposé), ou fusionnez-le avec un autre prestataire.`);
    await st.deletePrestataire(p.id);
    return c.body(null, 204);
  });

  /** Fusion d'un doublon dans un autre prestataire : prestations, intervenants et carnet de contacts sont repris. */
  r.post('/prestataires/:id/merge', async (c) => {
    const b = await body(c, mergePrestataireBody);
    const from = await st.getPrestataire(c.req.param('id'));
    const into = await st.getPrestataire(b.intoId);
    if (from.id === into.id) throw new HttpError(400, 'Choisissez un autre prestataire.');
    const user = userName(c);
    const merged = await st.putPrestataire({ ...into, contacts: [...into.contacts, ...from.contacts], updatedAt: nowIso(), updatedBy: user });
    const prestations = (await pr.listItemsAllProjects('prestations')).filter((x) => x.item.prestataireId === from.id);
    await pr.syncItems('prestations', prestations.map((x) => ({ projectId: x.projectId, itemId: x.item.id, fields: { prestataireId: into.id, prestataire: into.name } })), user);
    const contacts = (await pr.listItemsAllProjects('contacts')).filter((x) => x.item.prestataireId === from.id);
    await pr.syncItems('contacts', contacts.map((x) => ({ projectId: x.projectId, itemId: x.item.id, fields: { prestataireId: into.id, organisation: into.name } })), user);
    await st.deletePrestataire(from.id);
    return c.json(merged);
  });

  /** Crée les prestataires à partir des noms saisis avant le paramétrage et y rattache les prestations. */
  r.post('/prestataires/import', async (c) => {
    const user = userName(c);
    const now = nowIso();
    const byKey = new Map((await st.listPrestataires()).map((p) => [nameKey(p.name), p]));
    const unlinked = (await pr.listItemsAllProjects('prestations')).filter((x) => !x.item.prestataireId && x.item.prestataire.trim());
    let created = 0;
    const updates: { projectId: string; itemId: string; fields: Record<string, unknown> }[] = [];
    for (const { projectId, item } of unlinked) {
      let p = byKey.get(nameKey(item.prestataire));
      if (!p) {
        p = await st.putPrestataire({ id: newId(), name: item.prestataire.trim(), activite: '', website: '', notes: '', active: true, contacts: [], createdAt: now, createdBy: user, updatedAt: now, updatedBy: user });
        byKey.set(nameKey(p.name), p);
        created++;
      }
      updates.push({ projectId, itemId: item.id, fields: { prestataireId: p.id, prestataire: p.name } });
    }
    await pr.syncItems('prestations', updates, user);
    return c.json({ created, linked: updates.length });
  });

  // ---- Carnet de contacts ---------------------------------------------------------------

  r.post('/prestataires/:id/contacts', async (c) => {
    const b = await body(c, prestataireContactInputSchema);
    const p = await st.getPrestataire(c.req.param('id'));
    return c.json(await st.putPrestataire({ ...p, contacts: [...p.contacts, { ...b, id: newId() }], updatedAt: nowIso(), updatedBy: userName(c) }), 201);
  });

  r.put('/prestataires/:id/contacts/:cid', async (c) => {
    const b = await body(c, prestataireContactInputSchema);
    const p = await st.getPrestataire(c.req.param('id'));
    const cid = c.req.param('cid');
    if (!p.contacts.some((x) => x.id === cid)) throw new HttpError(404, 'Contact introuvable');
    const user = userName(c);
    const saved = await st.putPrestataire({ ...p, contacts: p.contacts.map((x) => (x.id === cid ? { ...b, id: cid } : x)), updatedAt: nowIso(), updatedBy: user });
    await syncDirectoryContact(saved, cid, user);
    return c.json(saved);
  });

  r.delete('/prestataires/:id/contacts/:cid', async (c) => {
    const p = await st.getPrestataire(c.req.param('id'));
    const cid = c.req.param('cid');
    const linked = (await pr.listItemsAllProjects('contacts')).filter((x) => x.item.directoryContactId === cid);
    if (linked.length) throw new HttpError(409, `Ce contact est intervenant dans ${linked.length} projet(s) : archivez-le plutôt.`);
    return c.json(await st.putPrestataire({ ...p, contacts: p.contacts.filter((x) => x.id !== cid), updatedAt: nowIso(), updatedBy: userName(c) }));
  });

  return r;
}

/**
 * Complète un élément de projet avec le paramétrage avant validation :
 *  - prestation : le prestataire doit être choisi dans le référentiel, son nom est recopié ;
 *  - intervenant lié au carnet d'un prestataire : nom, e-mail, téléphone et organisation viennent du carnet.
 * `before` est l'élément existant (modification) ou null (création).
 */
export async function resolveProjectRefs(kind: string, raw: Record<string, unknown>, before: Record<string, unknown> | null): Promise<Record<string, unknown>> {
  if (kind === 'prestations') {
    const touches = !before || 'prestataireId' in raw || 'prestataire' in raw;
    if (!touches) return raw;
    const id = String(raw.prestataireId ?? '');
    if (!id) throw new HttpError(400, 'Choisissez le prestataire dans la liste (ou créez-le avec le bouton « + »).');
    const p = await st.getPrestataire(id).catch(() => {
      throw new HttpError(400, 'Prestataire inconnu : rechargez la page.');
    });
    return { ...raw, prestataireId: p.id, prestataire: p.name };
  }
  if (kind === 'contacts') {
    const directoryContactId = String('directoryContactId' in raw ? raw.directoryContactId : (before?.directoryContactId ?? ''));
    if (!directoryContactId) return 'directoryContactId' in raw ? { ...raw, prestataireId: '' } : raw;
    const found = await st.findDirectoryContact(directoryContactId);
    if (!found) throw new HttpError(400, 'Contact du carnet introuvable : rechargez la page.');
    const { prestataire: p, contact } = found;
    const role = String(raw.role ?? before?.role ?? '') || contact.role;
    const linked: Partial<Contact> = { directoryContactId, prestataireId: p.id, name: contact.name, email: contact.email, phone: contact.phone, organisation: p.name, role };
    return { ...raw, ...linked };
  }
  return raw;
}
