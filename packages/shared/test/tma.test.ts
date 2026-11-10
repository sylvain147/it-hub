import { describe, expect, it } from 'vitest';
import { maskPersonalData, namesToMask } from '../src/tma/mask.js';
import { parseCsv, parseDeskDate, parseDeskExport } from '../src/tma/desk.js';
import { allocateHours, excelDate, parseTmaWorkbook } from '../src/tma/activity.js';
import { buildMonthReport, buildThemeStats, previousMonth } from '../src/tma/report.js';
import { writeXlsx } from '../src/files/xlsx.js';
import { matchTmaPeople, personKey, tmaHoursByContact, unknownTmaPeople } from '../src/tma/people.js';
import type { Prestataire } from '../src/settings.js';
import { DESK_CSV, tmaWorkbook } from './fixtures/tma.js';

describe('masquage des données personnelles', () => {
  it('retire e-mails, téléphones, numéros longs, noms après civilité, noms connus et signature', () => {
    const names = namesToMask(['Stella Koebel']);
    const out = maskPersonalData('Mme Gladieux, cliente 5265616521, cde 507691878, chèque n° 5578037 de 65,40 € (#11079). Tél 06 12 34 56 78, mail a.b@x.fr. Vu avec Stella Koebel. Cordialement, Stella', names);
    expect(out).toBe('Mme [nom], cliente [n° client], cde [n° commande], chèque n° [n° chèque] de 65,40 € (#11079). Tél [téléphone], mail [e-mail]. Vu avec [nom]. Cordialement, [nom]');
  });

  it('garde les codes entité, montants, dates et numéros de ticket', () => {
    expect(maskPersonalData('Entité 150 : 3,20 € le 08.10.2026, Desk #11542')).toBe('Entité 150 : 3,20 € le 08.10.2026, Desk #11542');
  });

  it('signature : ne masque pas un mot en minuscules', () => {
    expect(maskPersonalData('Merci beaucoup')).toBe('Merci beaucoup');
    expect(maskPersonalData('Bonne journée Jean Dupont')).toBe('Bonne journée [nom]');
  });
});

describe('export de tickets Desk', () => {
  it('découpe un CSV avec guillemets et retours à la ligne dans les champs', () => {
    expect(parseCsv('a;b\n"x;1";"y\n""z"""\n')).toEqual([
      ['a', 'b'],
      ['x;1', 'y\n"z"'],
    ]);
  });

  it('lit les dates Desk (jour en premier, AM/PM)', () => {
    expect(parseDeskDate('09/10/2026 08:34 AM')).toBe('2026-10-09T08:34');
    expect(parseDeskDate('10/10/2026 12:05 PM')).toBe('2026-10-10T12:05');
    expect(parseDeskDate('10/10/2026 12:05 AM')).toBe('2026-10-10T00:05');
    expect(parseDeskDate('2026-10-10 14:00')).toBe('2026-10-10T14:00');
    expect(parseDeskDate('n/a')).toBeNull();
  });

  it('ne garde que les colonnes utiles et masque sujets et descriptions', () => {
    const r = parseDeskExport(DESK_CSV);
    expect(r.tickets).toHaveLength(4);
    expect(r.ignoredColumns).toEqual(['Source', 'Contact Email', 'Environnement', 'VSO', 'Contournement', 'Client']);
    const [a, b] = r.tickets;
    expect(a).toMatchObject({ id: '11858', subject: 'Déclenchement rembt Mme [nom]', createdAt: '2026-10-09T08:34', category: 'Maint. corrective', cause: 'Anomalie système' });
    expect(a!.description).toContain('Cliente [n° client] La cde [n° commande]');
    expect(b!.description).not.toMatch(/Stella|06 12|@/);
    expect(b!.entity).toBe('200 helline');
    expect(JSON.stringify(r.tickets)).not.toContain('@exemple.fr');
  });

  it('refuse un fichier qui n’est pas un export Desk', () => {
    expect(() => parseDeskExport('a;b\n1;2')).toThrow(/export de tickets Desk/);
  });
});

describe('relevé TMA', () => {
  it('répartit les heures entre les tickets cités', () => {
    expect(allocateHours('Desk #11373, #11375.', 2)).toEqual({ tickets: [{ id: '11373', hours: 1 }, { id: '11375', hours: 1 }], otherHours: 0 });
    // Durées écrites : la part sans ticket (15 min) reste hors ticket.
    expect(allocateHours('Desk365#10734 vu avec R. (45 min) Contrôle Ogone (15 min) Desk365#10747 (1h)', 2)).toEqual({
      tickets: [{ id: '10734', hours: 0.75 }, { id: '10747', hours: 1 }],
      otherHours: 0.25,
    });
    expect(allocateHours('Pilotage TMA', 1)).toEqual({ tickets: [], otherHours: 1 });
  });

  it('convertit les dates Excel', () => {
    expect(excelDate(46296)).toBe('2026-10-01');
    expect(excelDate('15/09/2026')).toBe('2026-09-15');
  });

  it('lit le classeur : personnes, heures (1 j = 8 h), tickets, pilotage', () => {
    const r = parseTmaWorkbook(tmaWorkbook());
    expect(r.month).toBe('2026-10');
    expect(r.skipped).toBe(1); // ligne « Somme »
    expect(r.entries).toHaveLength(5);
    const alain = r.entries.find((e) => e.comment.startsWith('Desk365'))!;
    expect(alain).toMatchObject({ person: 'Alain Didier', hours: 4.25, tickets: [{ id: '10555', hours: 3 }, { id: '8503', hours: 1.25 }], otherHours: 0 });
    expect(r.entries.find((e) => e.comment.startsWith('Pilotage'))).toMatchObject({ activity: 'pilotage', otherHours: 1 });
    expect(r.entries.find((e) => e.comment.startsWith('Relance'))!.comment).toBe('Relance traitement cliente [n° client] (30 min)');
    expect(r.entries.find((e) => e.person === 'Jérôme Martin')).toBeTruthy();
  });

  it('refuse un classeur sans les colonnes attendues', () => {
    expect(() => parseTmaWorkbook(writeXlsx([{ name: 'X', rows: [['a', 'b'], [1, 2]] }]))).toThrow(/Relevé TMA non reconnu/);
  });
});

describe('rapports', () => {
  const tickets = parseDeskExport(DESK_CSV).tickets.map((t) => ({ ...t, theme: /ch[eè]que/i.test(t.subject) ? 'Chèques' : '' }));
  const { entries } = parseTmaWorkbook(tmaWorkbook());

  it('calcule le rapport du mois', () => {
    const r = buildMonthReport('2026-10', entries, tickets, { month: '2026-09', entries: [{ ...entries[0]!, date: '2026-09-30' }] });
    expect(r).toMatchObject({ totalHours: 8.8, ticketHours: 7.3, pilotageHours: 1, otherHours: 0.5, createdTickets: 3, entryCount: 5, unknownTickets: ['8503'] });
    expect(r.byTicket[0]).toMatchObject({ id: '10555', hours: 3, people: ['Alain Didier'], ticket: { theme: 'Chèques', category: 'Maint. évolutive' } });
    expect(r.byPerson.map((p) => [p.key, p.hours, p.ticketHours])).toEqual([
      ['Alain Didier', 4.8, 4.3],
      ['Romain Durand', 2, 2],
      ['Alexandre Robert', 1, 0],
      ['Jérôme Martin', 1, 1],
    ]);
    expect(r.created.byTheme).toEqual([
      { key: 'Non classé', hours: 0, count: 2 },
      { key: 'Chèques', hours: 0, count: 1 },
    ]);
    expect(r.unclassified).toBe(2);
    expect(r.unattached[0]).toMatchObject({ hours: 1, activity: 'pilotage' });
    expect(r.previous).toMatchObject({ month: '2026-09', totalHours: 1, createdTickets: 0 });
  });

  it('calcule les récurrences par thème', () => {
    const s = buildThemeStats(tickets, entries);
    expect(s.months).toEqual(['2026-08', '2026-10']);
    expect(s.themes.find((t) => t.theme === 'Chèques')).toMatchObject({ tickets: 2, byMonth: { '2026-08': 1, '2026-10': 1 }, hours: 4 });
  });

  it('mois précédent', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
  });
});

describe('intervenants du relevé et contacts des prestataires', () => {
  const contact = (id: string, name: string, active = true) => ({ id, name, role: '', email: '', phone: '', notes: '', active });
  const presta = (id: string, name: string, contacts: Prestataire['contacts'], active = true): Prestataire => ({
    id, name, activite: '', website: '', notes: '', active, contacts, createdAt: '', createdBy: '', updatedAt: '', updatedBy: '',
  });
  const prestataires = [
    presta('old', 'Ancien', [contact('c0', 'Romain Durand')], false),
    presta('coq', 'Coqliqo', [contact('c1', 'DURAND Romain'), contact('c2', 'Jérôme MARTIN'), contact('c3', 'Alain Didier', false)]),
  ];

  it('compare les noms sans casse, accents ni ordre prénom / nom', () => {
    expect(personKey('Durand  Romain')).toBe(personKey('ROMAIN DURAND'));
    expect(personKey('Jérôme Martin')).toBe(personKey('martin jerome'));
    expect(personKey('Jean-Marc Petit')).toBe(personKey('Petit Jean Marc'));
    expect(personKey('Romain Durand')).not.toBe(personKey('Romain Dupont'));
  });

  it('retrouve le contact (prestataire actif d’abord) et signale les inconnus', () => {
    const m = matchTmaPeople(['Romain Durand', 'Alain Didier', 'Alexandre Robert'], prestataires);
    expect(m.get('Romain Durand')).toEqual({ prestataireId: 'coq', prestataireName: 'Coqliqo', contactId: 'c1', contactName: 'DURAND Romain' });
    expect(m.get('Alain Didier')?.contactId).toBe('c3'); // contact archivé : reconnu quand même
    expect(m.get('Alexandre Robert')).toBeNull();
    expect(unknownTmaPeople(parseTmaWorkbook(tmaWorkbook()).entries, prestataires)).toEqual(['Alexandre Robert']);
    expect(unknownTmaPeople([{ person: 'X' }], [])).toEqual(['X']);
  });

  it('additionne le temps des relevés par contact, par prestataire et par mois', () => {
    const oct = parseTmaWorkbook(tmaWorkbook()).entries;
    const r = tmaHoursByContact([{ month: '2026-09', entries: oct.filter((e) => e.person === 'Romain Durand') }, { month: '2026-10', entries: oct }], prestataires);
    expect(r.byContact.c1).toEqual({ hours: 4, months: [{ month: '2026-09', hours: 2 }, { month: '2026-10', hours: 2 }] });
    expect(r.byContact.c3!.hours).toBe(4.75);
    expect(r.byPrestataire.coq).toEqual({ hours: 9.75, months: [{ month: '2026-09', hours: 2 }, { month: '2026-10', hours: 7.75 }] });
    expect(r.byPrestataire.old).toBeUndefined();
    expect(r.unknown).toEqual([{ person: 'Alexandre Robert', hours: 1 }]);
  });
});
