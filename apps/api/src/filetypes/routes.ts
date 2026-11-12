import { Hono } from 'hono';
import { adjustFileTypeBody, createFileTypeBody, saveFileTypeSpecBody, updateFileTypeBody } from '@samm/shared';
import { userName } from '../auth.js';
import { HttpError } from '../lib/util.js';
import { startJob } from '../jobs/runner.js';
import { aiCall, buildPlan, n, preview, wantsPreview } from '../ai/plan.js';
import { body, intParam } from '../lib/http.js';
import * as ft from './repo.js';

/** Routes du module « Lecteur de fichiers » (montées sous /api/filetypes). */
export function fileTypeRoutes() {
  const r = new Hono();

  r.get('/', async (c) => c.json(await ft.listFileTypes()));

  r.post('/', async (c) => {
    const b = await body(c, createFileTypeBody);
    const user = userName(c);
    if (wantsPreview(c)) {
      const docs = JSON.stringify(b.documents ?? '').length;
      return preview(
        c,
        await buildPlan('filetype_create', `Création de la fiche de lecture « ${b.name} »`, {
          steps: ['L’IA étudie l’extrait du fichier (et la documentation fournie) pour en déduire le format : séparateur, types de lignes, champs, positions.', 'Elle rédige une fiche de lecture déclarative, puis la vérifie sur l’extrait.'],
          sent: [`Un extrait du fichier (${n(b.excerpt.length)} caractères)${b.anonymized ? ', anonymisé' : ' (non anonymisé, à votre demande)'}.`, ...(docs > 2 ? [`La documentation jointe (${n(docs)} caractères).`] : []), 'Le fichier complet reste sur votre poste : il n’est jamais envoyé.'],
          changes: ['Le type de fichier est créé avec sa fiche de lecture (modifiable ensuite) ; la lecture des fichiers se fait ensuite sans IA.'],
          calls: [aiCall('Proposer la fiche de lecture', 'fast', b.excerpt.length + docs, 4000), aiCall('Mettre au point la fiche', 'smart', b.excerpt.length + docs + 6000, 4000)],
        }),
      );
    }
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
    if (wantsPreview(c)) {
      const spec = JSON.stringify(detail.spec).length;
      return preview(
        c,
        await buildPlan('filetype_adjust', `Ajustement de la fiche « ${detail.name} »`, {
          steps: [`L’IA corrige la fiche de lecture selon votre demande : « ${b.instruction.slice(0, 200)}${b.instruction.length > 200 ? '…' : ''} ».`],
          sent: [`La fiche actuelle (${n(spec)} caractères), votre demande${b.extraLines?.length ? ` et ${b.extraLines.length} ligne(s) d’exemple` : ''}, l’extrait enregistré.`, 'Le fichier complet reste sur votre poste.'],
          changes: ['Une nouvelle version de la fiche est créée (l’ancienne reste dans l’historique).'],
          calls: [aiCall('Ajuster la fiche', 'smart', spec + b.instruction.length + 6000, 3000)],
        }),
      );
    }
    return c.json(await startJob('filetype_adjust', id, userName(c), { baseSeq: b.baseSeq, instruction: b.instruction, extraLines: b.extraLines }), 202);
  });

  r.post('/:id/retry', async (c) => {
    // Relance la création si la première tentative a échoué.
    const id = c.req.param('id');
    const detail = await ft.getFileTypeDetail(id);
    if (detail.spec) throw new HttpError(400, 'La fiche existe déjà : utilisez l’ajustement.');
    if (wantsPreview(c)) {
      return preview(
        c,
        await buildPlan('filetype_create', `Nouvelle tentative : fiche de lecture « ${detail.name} »`, {
          steps: ['L’IA reprend la création de la fiche de lecture à partir de l’extrait enregistré (la première tentative a échoué).'],
          sent: ['L’extrait enregistré du fichier et la documentation fournie à la création.', 'Le fichier complet reste sur votre poste.'],
          changes: ['La fiche de lecture est créée (modifiable ensuite).'],
          calls: [aiCall('Proposer la fiche de lecture', 'fast', 8000, 4000), aiCall('Mettre au point la fiche', 'smart', 14000, 4000)],
        }),
      );
    }
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
