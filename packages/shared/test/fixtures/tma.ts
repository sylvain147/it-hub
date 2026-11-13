/** Données fictives au format des exports réels (Desk365 et relevé TMA du prestataire). */
import type { PdfTextItem } from '../../src/files/pdfTable.js';
import { excelDate } from '../../src/tma/activity.js';
import { writeXlsx } from '../../src/files/xlsx.js';

/** Export Desk fictif, au format de Desk365 (BOM, guillemets, description sur plusieurs lignes). */
export const DESK_CSV =
  '﻿"Ticket Number","Sujet","Description","Source","Created Time","Contact Name","Contact Email","Assign To","Category","Priorité","Statut","Environnement","Produit","Cause","VSO","Entité/Magasin","Contournement","Client"\n' +
  '"11858","Déclenchement rembt Mme Gladieux","""Bonjour, Entité 150 Cliente 5265616521 La cde 507691878 a été annulée et le rembt ne se déclenche pas.\nMerci d\'avance.""","Support Portal","09/10/2026 08:34 AM","Stéphanie Klein","stephanie.klein@exemple.fr","Romain Durand","Maint. corrective","Urgent","Clôturé","Production","","Anomalie système","","","Non","WGF"\n' +
  '"11884","chèque saisi en double","""Bonjour, Le chèque n° 5578037 de 65,40 € a été enregistré deux fois. Appelez-moi au 06 12 34 56 78 ou stella.k@exemple.fr. Cordialement, Stella""","Support Portal","09/10/2026 10:59 AM","Stella Koebel","stella.koebel@exemple.fr","Jérôme Martin","Intervention","Urgent","Clôturé","Production","Neeet VAD","Correction de données","","200 helline","Non","WGF"\n' +
  '"11901","Cdes internet état C Paypal paiement à rattacher","""Merci de rattacher le paiement.""","Support Portal","10/10/2026 02:15 PM","Stella Koebel","stella.koebel@exemple.fr","Jérôme Martin","Intervention","Normal","En cours","Production","Neeet VAD","Correction de données","","150 moda","Non","WGF"\n' +
  '"10555","Chèque à 90 jours ramené à 50 jours","""Évolution demandée.""","Support Portal","25/08/2026 09:38 AM","Aurélien Petit","a.petit@exemple.fr","Romain Durand","Maint. évolutive","Normal","Résolu livré en production","Production","Neeet VAD","Evolution besoin utilisateur","","","Non","WGF"\n';

/** Relevé TMA fictif : une ligne par activité (date Excel, fraction de journée, nom, prénom, commentaire). */
export function tmaWorkbook(rows: [number, number, string, string, string][] = TMA_ROWS): Uint8Array {
  return writeXlsx([{ name: 'Feuil1', rows: [["Date de l'activité", 'Nb jours', 'Nom', 'Prénom', 'Commentaires'], ...rows, ['Somme :', 1.5, null, null, null] as never] }]);
}
// 46296 = 01/10/2026
export const TMA_ROWS: [number, number, string, string, string][] = [
  [46296, 0.25, 'DURAND', 'ROMAIN', 'Desk #11858, #11884.'],
  [46296, 0.125, 'MARTIN', 'JÉRÔME', '#11901 - Cdes internet état C Paypal'],
  [46297, 0.53125, 'DIDIER', 'ALAIN', 'Desk365#10555 (3h) Desk365#8503 MEP (1h15)'],
  [46297, 0.125, 'ROBERT', 'ALEXANDRE', 'Pilotage TMA + Copil'],
  [46298, 0.0625, 'DIDIER', 'ALAIN', 'Relance traitement cliente 9105152207 (30 min)'],
];

/** Colonnes du relevé imprimé en PDF (abscisse gauche, en points). */
const PDF_COLUMNS = [52.6, 103.7, 154.8, 206.2, 257.3, 320.9, 372.1, 463.9, 541.8];
const PDF_AXES = [['TMA', 'Corrective', 'Régie'], ['Suivi de', 'Projet En', 'Régie'], ['Assistance', 'Utilisateurs', 'Régie']];

/**
 * Texte du relevé fictif tel que pdf.js le lit dans l'impression PDF du classeur : cellules centrées verticalement,
 * colonne « Axe 3 » sur trois lignes en petits caractères, commentaires longs coupés, en-tête sur la première page
 * seulement, ligne « Somme » à la fin. `padding` : marge haute et basse des cellules (0 : lignes collées).
 */
export function tmaPdfItems(rows: [number, number, string, string, string][] = TMA_ROWS, { perPage = 3, padding = 8 } = {}): PdfTextItem[] {
  const items: PdfTextItem[] = [];
  let page = 1;
  let y = 540;
  const put = (col: number, lines: string[], center: number, height = 10) => {
    const step = height * 1.23;
    lines.forEach((str, k) => items.push({ page, x: PDF_COLUMNS[col]!, y: center + ((lines.length - 1) / 2 - k) * step, width: str.length * height * 0.5, height, str }));
  };
  const row = (cells: (string[] | null)[], small: number[] = []) => {
    const h = Math.max(...cells.map((c, i) => (c ? c.length * (small.includes(i) ? 8 : 10) * 1.23 : 0))) + 2 * padding;
    const center = y - h / 2;
    cells.forEach((c, i) => c && put(i, c, center, small.includes(i) ? 8 : 10));
    y -= h;
  };
  const wrap = (s: string) => s.match(/.{1,40}(?:\s|$)/g)!.map((l) => l.trim());
  const days = (n: number) => n.toFixed(2).replace('.', ',');
  row([['Axe 1'], ['Axe 2'], ['Axe 3'], ['Type de', 'facturation 3'], ["Date de l'activité"], ['Nb jours'], ['Nom'], ['Prénom'], ['Commentaires']], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  rows.forEach(([date, d, last, first, comment], i) => {
    if (i && i % perPage === 0) {
      page++;
      y = 540;
    }
    const [yyyy, mm, dd] = excelDate(date)!.split('-');
    row([['WITT', 'GROUP'], ['WITT TMA'], PDF_AXES[i % PDF_AXES.length]!, ['Réel', '(régie)'], [`${dd}/${mm}/${yyyy}`], [days(d)], [last], [first], wrap(comment)], [0, 1, 2]);
  });
  row([null, null, null, null, ['Somme :'], [days(rows.reduce((n, r) => n + r[1], 0))], null, null, null]);
  return items;
}
