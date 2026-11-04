import { fileSpecSchema, type FileSpecInput } from '../../src/files/spec.js';

/** Fiche écrite à la main pour le fichier de démonstration `demo.ww`. */
export const demoSpecInput: FileSpecInput = {
  format: 'fixed',
  encoding: 'utf-8',
  fileNamePattern: '*.ww',
  recordTypes: [
    {
      code: '3000',
      name: 'En-tête de fichier',
      role: 'header',
      match: [{ start: 5, length: 4, value: '3000' }],
      fields: [
        { key: 'type', label: 'Type', start: 5, length: 4, type: 'code' },
        { key: 'date', label: 'Date du fichier', start: 9, length: 10, type: 'date', dateFormat: 'YYYY-MM-DD' },
        { key: 'numero', label: 'Numéro d’envoi', start: 19, length: 5, type: 'integer' },
      ],
    },
    { code: '3100', name: 'Début de bloc factures', role: 'header', match: [{ start: 5, length: 4, value: '3100' }], fields: [{ key: 'date', label: 'Date', start: 9, length: 10, type: 'date', dateFormat: 'YYYY-MM-DD' }] },
    {
      code: '3101',
      name: 'Facture',
      role: 'group',
      match: [{ start: 5, length: 4, value: '3101' }],
      fields: [
        { key: 'numero', label: 'N° facture', start: 9, length: 19, type: 'integer' },
        { key: 'statut', label: 'Statut', start: 33, length: 1, type: 'code', values: [{ code: 'N', label: 'Normale' }] },
        { key: 'commande', label: 'N° commande', start: 34, length: 18, type: 'text' },
      ],
    },
    {
      code: '3102',
      name: 'Ligne article',
      role: 'detail',
      parent: '3101',
      match: [{ start: 5, length: 4, value: '3102' }],
      fields: [
        { key: 'facture', label: 'N° facture', start: 9, length: 7, type: 'integer' },
        { key: 'ligne', label: 'N° ligne', start: 16, length: 2, type: 'integer' },
        { key: 'reference', label: 'Référence', start: 20, length: 6, type: 'text' },
        { key: 'libelle', label: 'Libellé', start: 65, length: 30, type: 'text' },
        { key: 'quantite', label: 'Quantité', start: 95, length: 6, type: 'integer' },
        { key: 'montant', label: 'Montant', start: 115, length: 14, type: 'decimal', impliedDecimals: 4 },
        { key: 'devise', label: 'Devise', start: 130, length: 3, type: 'code', values: [{ code: 'EUR', label: 'Euro' }] },
      ],
    },
    {
      code: '3199',
      name: 'Fin de bloc factures',
      role: 'trailer',
      match: [{ start: 5, length: 4, value: '3199' }],
      fields: [{ key: 'nb_factures', label: 'Nombre de factures', start: 9, length: 7, type: 'integer' }],
    },
    { code: '3300', name: 'Début de bloc avoirs', role: 'header', match: [{ start: 5, length: 4, value: '3300' }], fields: [] },
    { code: '3399', name: 'Fin de bloc avoirs', role: 'trailer', match: [{ start: 5, length: 4, value: '3399' }], fields: [{ key: 'nb', label: 'Nombre', start: 9, length: 7, type: 'integer' }] },
  ],
  checks: [
    { label: 'Nombre de factures annoncé', kind: 'count', expectedRecord: '3199', expectedField: 'nb_factures', targetRecords: ['3101'], blockStart: '3100' },
    { label: 'Nombre d’avoirs annoncé', kind: 'count', expectedRecord: '3399', expectedField: 'nb', targetRecords: ['3301'], blockStart: '3300' },
  ],
};

export const demoSpec = fileSpecSchema.parse(demoSpecInput);
