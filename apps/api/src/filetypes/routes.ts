import { Hono } from 'hono';
import { adjustFileTypeBody, createFileTypeBody, saveFileTypeSpecBody, updateFileTypeBody } from '@samm/shared';
import { userName } from '../auth.js';
import { HttpError } from '../lib/util.js';
import { startJob } from '../jobs/runner.js';
import { body, intParam } from '../lib/http.js';
import * as ft from './repo.js';

/** Routes du module « Lecteur de fichiers » (montées sous /api/filetypes). */
export function fileTypeRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await ft.listFileTypes()));

  r.post('/', async (c) => {
    const b = await body(c, createFileTypeBody);
    const user = userName(c);
    const id = await ft.createFileType({
      name: b.name,
      description: b.description,
      notes: b.notes,
      sampleFileName: b.sampleFileName,
      context: { excerpt: b.excerpt, anonymized: b.anonymized, documents: b.documents },
      user,
    });
    const job = await startJob('filetype_create', id, user, {});
    return c.json({ id, job }, 201);
  });

  r.get('/:id', async (c) => c.json(await ft.getFileTypeDetail(c.req.param('id'))));

  r.patch('/:id', async (c) => {
    const b = await body(c, updateFileTypeBody);
    await ft.updateFileTypeInfo(c.req.param('id'), b.name, b.description, userName(c));
    return c.json(await ft.getFileTypeDetail(c.req.param('id')));
  });

  r.delete('/:id', async (c) => {
    await ft.requireNoActiveJob(c.req.param('id'));
    await ft.deleteFileType(c.req.param('id'));
    return c.body(null, 204);
  });

  r.put('/:id/spec', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, saveFileTypeSpecBody);
    await ft.requireNoActiveJob(id);
    const version = await ft.saveSpecVersion(id, b.baseSeq, b.spec, { user: userName(c), origin: 'manuel', comment: b.comment });
    return c.json({ version, detail: await ft.getFileTypeDetail(id) });
  });

  r.post('/:id/adjust', async (c) => {
    const id = c.req.param('id');
    const b = await body(c, adjustFileTypeBody);
    const detail = await ft.getFileTypeDetail(id);
    if (!detail.spec) throw new HttpError(400, 'La fiche n’a pas encore été créée.');
    return c.json(await startJob('filetype_adjust', id, userName(c), { baseSeq: b.baseSeq, instruction: b.instruction, extraLines: b.extraLines }), 202);
  });

  r.post('/:id/retry', async (c) => {
    // Relance la création si la première tentative a échoué.
    const id = c.req.param('id');
    const detail = await ft.getFileTypeDetail(id);
    if (detail.spec) throw new HttpError(400, 'La fiche existe déjà : utilisez l’ajustement.');
    return c.json(await startJob('filetype_create', id, userName(c), {}), 202);
  });

  r.get('/:id/versions', async (c) => c.json(await ft.listSpecVersions(c.req.param('id'))));

  r.get('/:id/versions/:seq', async (c) => c.json(await ft.getSpecVersion(c.req.param('id'), intParam(c, 'seq'))));

  r.post('/:id/versions/:seq/restore', async (c) => {
    const id = c.req.param('id');
    const seq = intParam(c, 'seq');
    const b = await body(c, saveFileTypeSpecBody.pick({ baseSeq: true }));
    await ft.requireNoActiveJob(id);
    const spec = await ft.getSpecVersion(id, seq);
    const version = await ft.saveSpecVersion(id, b.baseSeq, spec, { user: userName(c), origin: 'restauration', comment: `Restauration de la version ${seq}` });
    return c.json({ version, detail: await ft.getFileTypeDetail(id) });
  });

  return r;
}
