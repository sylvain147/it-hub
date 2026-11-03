/**
 * Génère des exports Word et PDF d'exemple (reprise du CDC modèle) pour vérifier la mise en page.
 *   npx tsx scripts/sample-export.ts <dossier-de-sortie> [image.png]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageSize } from 'image-size';
import { markdownToDoc, type CdcDocument } from '@samm/shared';
import { renderDocx } from '../src/export/docx.js';
import { renderPdf } from '../src/export/pdf.js';
import type { LoadedImage } from '../src/export/common.js';

const out = process.argv[2] ?? '.';
const imagePath = process.argv[3];

const doc: CdcDocument = {
  meta: {
    title: "Migration de l'offre Coliéco vers l'offre Essentiel (La Poste)",
    prestataire: 'Coqliqo',
    projet: '',
    status: 'valide',
    phase: 'developpement',
    jalons: [
      { id: 'a', label: 'Testing phase 1', date: '2026-10-23' },
      { id: 'b', label: 'Testing phase 2', date: '2026-10-30' },
      { id: 'c', label: 'Production', date: '2026-11-16' },
    ],
    estimationJours: 8,
    tags: [],
  },
  sections: [
    {
      id: 's1',
      kind: 'contexte',
      title: 'Contexte',
      content: markdownToDoc(`La Poste met fin à son offre Coliéco à compter de janvier 2027. Cette offre doit être remplacée par la nouvelle offre « Essentiel ».

Points clés :

- L'offre Colissimo est maintenue à l'identique.
- Le tarif reste inchangé.
- Le compte Coliéco est remplacé par un compte « Essentiel » ; nos comptes existants sont conservés.`),
    },
    {
      id: 's2',
      kind: 'standard',
      title: 'Enjeux',
      content: markdownToDoc(`Les flux concernés représentent plus de **100 000 colis par mois**. Compte tenu de l'écart tarifaire entre les deux offres, cette situation pourrait engendrer un surcoût significatif.`),
    },
    {
      id: 's3',
      kind: 'standard',
      title: 'Périmètre du développement',
      content: markdownToDoc(`## Développements demandés à Coqliqo

- **Base de données** : Paramétrage du mode de livraison ESS « La Poste Essentiel » : intégrer ce nouveau mode dans l'ensemble des tables applicatives (notamment la table EVE).
- **Contrôle d'éligibilité et bascule automatique** : dans la procédure GENCOL, vérifier le poids (seuil de 2 kg) et les dimensions (26 × 26 × 34 cm).
  - Si la commande n'est pas éligible, bascule en Colissimo.
- **Webservices** : Mettre à jour les flux concernés.

## Passage Essentiel en Colissimo

Deux scénarios sont retenus, l'arbitrage restant à effectuer :

1. Convertir réellement la commande en Colissimo ;
2. Conserver le mode Essentiel et appliquer un indicateur de traitement Colissimo.`),
    },
    {
      id: 's4',
      kind: 'annexes',
      title: 'Annexe',
      content: markdownToDoc(`### Correspondance codes colis / poids et dimensions

| TYPE | LONGUEUR | LARGEUR | HAUTEUR | POIDS |
| --- | --- | --- | --- | --- |
| T1 | 0,32 | 0,24 | 0,07 | 190,00 |
| T2 | 0,32 | 0,24 | 0,15 | 330,00 |

### Modification des terminologies

${imagePath ? '![Écran Soneeet](asset:demo/img1)' : ''}`),
    },
  ],
};

const images = new Map<string, LoadedImage>();
if (imagePath) {
  const data = readFileSync(imagePath);
  const s = imageSize(data);
  images.set('asset:demo/img1', { data, type: s.type === 'jpg' ? 'jpg' : 'png', width: s.width!, height: s.height! });
}
for (const lang of ['fr'] as const) {
  writeFileSync(join(out, `exemple-${lang}.docx`), await renderDocx(doc, '1.0', lang, images));
  writeFileSync(join(out, `exemple-${lang}.pdf`), await renderPdf(doc, '1.0', lang, images));
}
console.log('Exports écrits dans', out);
