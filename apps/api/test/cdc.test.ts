import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupTestEnv, TINY_PNG } from './helpers.js';

const TRANSCRIPT = `Julien: bon alors on se fait le point sur Coliéco, La Poste arrête l'offre en janvier 2027
Marie: oui il faut basculer vers l'offre Essentiel, le prestataire Coqliqo doit faire le dev
Julien: faut paramétrer le mode de livraison ESS dans la table EVE et les tables de référence
Marie: et le contrôle d'éligibilité, poids max 2 kg, dimensions 26 x 26 x 34 cm
Julien: sinon bascule automatique en Colissimo sans surcoût pour le client
Marie: on vise une mise en prod le 16 novembre, testing le 30 octobre`;

let env: Awaited<ReturnType<typeof setupTestEnv>>;
let id: string;

beforeAll(async () => {
  env = await setupTestEnv();
});
afterAll(async () => env.close());

describe('parcours complet du générateur de CDC', () => {
  it('crée un CDC depuis une transcription', async () => {
    const res = await env.call('POST', '/cdcs', { meta: { title: 'Migration Coliéco' }, transcript: TRANSCRIPT });
    expect(res.status).toBe(201);
    id = res.json.id;
    const job = await env.waitJob(res.json.job.id);
    expect(job.error).toBe('');
    expect(job.status).toBe('termine');
    expect(job.resultVersionSeq).toBe(2);

    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    expect(detail.document.meta.title).toBe('Migration Coliéco');
    expect(detail.document.sections[0].kind).toBe('contexte');
    expect(detail.currentVersion.label).toBe('0.2');
    expect(detail.openQuestions).toBe(3);
    expect(detail.activeJobId).toBeNull();

    const { json: sources } = await env.call('GET', `/cdcs/${id}/sources`);
    expect(sources).toHaveLength(1);
    expect(sources[0].notes).toContain('##');
  });

  it('refuse un enregistrement basé sur une version obsolète', async () => {
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const res = await env.call('PUT', `/cdcs/${id}`, { baseSeq: 1, document: detail.document, comment: '' });
    expect(res.status).toBe(409);
  });

  it('enregistre une édition manuelle avec une image', async () => {
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const asset = await env.call('POST', `/cdcs/${id}/assets`, { contentType: 'image/png', size: TINY_PNG.length });
    expect(asset.status).toBe(200);
    const key = decodeURIComponent(asset.json.upload.url.slice('/local-blob/'.length));
    await env.store.put(key, TINY_PNG, 'image/png');
    const doc = detail.document;
    doc.sections.push({
      id: 'annexes1',
      kind: 'annexes',
      title: 'Annexe',
      content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Capture' }] }, { type: 'image', attrs: { src: asset.json.ref, alt: 'écran' } }] },
    });
    doc.meta.estimationJours = 8;
    const res = await env.call('PUT', `/cdcs/${id}`, { baseSeq: detail.currentVersion.seq, document: doc, comment: 'Ajout annexe' });
    expect(res.status).toBe(200);
    expect(res.json.version.label).toBe('0.3');
    expect(res.json.version.origin).toBe('manuel');
  });

  it('exige échéance et estimation pour valider', async () => {
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const doc = { ...detail.document, meta: { ...detail.document.meta, status: 'valide', jalons: [] } };
    const res = await env.call('PUT', `/cdcs/${id}`, { baseSeq: detail.currentVersion.seq, document: doc, comment: '' });
    expect(res.status).toBe(422);
  });

  it('intègre les réponses aux questions', async () => {
    const { json: questions } = await env.call('GET', `/cdcs/${id}/questions`);
    const q = questions[0];
    const upd = await env.call('PATCH', `/cdcs/${id}/questions/${q.id}`, { answer: 'Le prestataire est Coqliqo.' });
    expect(upd.json.status).toBe('repondue');
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const start = await env.call('POST', `/cdcs/${id}/questions/integrate`, { baseSeq: detail.currentVersion.seq });
    expect(start.status).toBe(202);
    const job = await env.waitJob(start.json.id);
    expect(job.error).toBe('');
    const { json: after } = await env.call('GET', `/cdcs/${id}/questions`);
    expect(after.find((x: any) => x.id === q.id).status).toBe('integree');
    const { json: d2 } = await env.call('GET', `/cdcs/${id}`);
    expect(d2.currentVersion.label).toBe('0.4');
    // l'image de l'annexe est toujours là
    expect(JSON.stringify(d2.document)).toContain('asset:');
  });

  it('bloque l’édition pendant une tâche IA et refuse deux tâches simultanées', async () => {
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const first = await env.call('POST', `/cdcs/${id}/sources`, { baseSeq: detail.currentVersion.seq, title: 'Réunion 2', text: TRANSCRIPT + '\nMarie: finalement 10 jours de charge' });
    expect(first.status).toBe(202);
    const second = await env.call('POST', `/cdcs/${id}/translations`, { lang: 'en' });
    expect(second.status).toBe(409);
    const save = await env.call('PUT', `/cdcs/${id}`, { baseSeq: detail.currentVersion.seq, document: detail.document, comment: '' });
    expect(save.status).toBe(409);
    const job = await env.waitJob(first.json.id);
    expect(job.error).toBe('');
    const { json: sources } = await env.call('GET', `/cdcs/${id}/sources`);
    expect(sources).toHaveLength(2);
  });

  it('retravaille une section', async () => {
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const sec = detail.document.sections[1];
    const start = await env.call('POST', `/cdcs/${id}/sections/${sec.id}/rework`, { baseSeq: detail.currentVersion.seq, instruction: 'Plus concis' });
    const job = await env.waitJob(start.json.id);
    expect(job.error).toBe('');
    const { json: d2 } = await env.call('GET', `/cdcs/${id}`);
    expect(d2.document.sections.find((s: any) => s.id === sec.id)).toBeTruthy();
  });

  it('traduit en anglais en réutilisant le cache', async () => {
    const t1 = await env.call('POST', `/cdcs/${id}/translations`, { lang: 'en' });
    const j1 = await env.waitJob(t1.json.id);
    expect(j1.error).toBe('');
    const t2 = await env.call('POST', `/cdcs/${id}/translations`, { lang: 'en' });
    const j2 = await env.waitJob(t2.json.id);
    expect(j2.step).toMatch(/0 bloc\(s\) traduit/);
    const { json: list } = await env.call('GET', `/cdcs/${id}/translations`);
    expect(list[0]).toMatchObject({ lang: 'en', outdated: false });
  });

  it('exporte en Word et en PDF, en français et en anglais', async () => {
    for (const lang of ['fr', 'en']) {
      for (const format of ['docx', 'pdf']) {
        const res = await env.call('POST', `/cdcs/${id}/exports`, { format, lang });
        expect(res.status, JSON.stringify(res.json)).toBe(200);
        const key = decodeURIComponent(res.json.url.slice('/local-blob/'.length).split('?')[0]);
        const buf = (await env.store.get(key))!;
        expect(buf.subarray(0, 4).toString('latin1')).toBe(format === 'docx' ? 'PK\u0003\u0004' : '%PDF');
        expect(res.json.fileName).toMatch(new RegExp(`\\.${format}$`));
      }
    }
  });

  it('liste les versions et en restaure une', async () => {
    const { json: versions } = await env.call('GET', `/cdcs/${id}/versions`);
    expect(versions.length).toBeGreaterThanOrEqual(6);
    expect(versions[0].seq).toBeGreaterThan(versions[1].seq);
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const res = await env.call('POST', `/cdcs/${id}/versions/2/restore`, { baseSeq: detail.currentVersion.seq });
    expect(res.status).toBe(200);
    expect(res.json.version.origin).toBe('restauration');
    const { json: v2 } = await env.call('GET', `/cdcs/${id}/versions/2`);
    expect(res.json.detail.document).toEqual(v2.document);
    const { json: tr } = await env.call('GET', `/cdcs/${id}/translations`);
    expect(tr[0].outdated).toBe(true);
  });

  it('passe en version majeure à la validation', async () => {
    const { json: detail } = await env.call('GET', `/cdcs/${id}`);
    const doc = detail.document;
    doc.meta.status = 'valide';
    doc.meta.estimationJours = 8;
    doc.meta.jalons = [{ id: 'j1', label: 'Production', date: '2026-11-16' }];
    const res = await env.call('PUT', `/cdcs/${id}`, { baseSeq: detail.currentVersion.seq, document: doc, comment: 'Validation' });
    expect(res.status).toBe(200);
    expect(res.json.version.label).toBe('1.0');
    const { json: list } = await env.call('GET', `/cdcs`);
    expect(list[0]).toMatchObject({ id, status: 'valide', nextJalon: { date: '2026-11-16' } });
  });

  it('trace la consommation IA', async () => {
    const { json: usage } = await env.call('GET', `/usage`);
    expect(usage.calls).toBeGreaterThanOrEqual(6);
    expect(usage.byOperation.map((r: any) => r.key)).toEqual(expect.arrayContaining(['extraction', 'redaction', 'traduction']));
  });
});
