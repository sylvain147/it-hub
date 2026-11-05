/** Données fictives au format des exports réels (Desk365 et relevé TMA du prestataire). */
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
