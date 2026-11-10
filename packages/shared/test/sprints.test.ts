import { describe, expect, it } from 'vitest';
import { ticketTypeTitle, withTicketType } from '../src/settings.js';
import {
  buildSprintPreparation,
  buildSprintReport,
  cardColor,
  describeCardRule,
  type CardRule,
  movementLabel,
  normalizeTaskRecord,
  sprintPreparationToMarkdown,
  sprintReportToMarkdown,
  TICKET_STATUS_LABELS,
  type Sprint,
  type TicketView,
} from '../src/index.js';

/** Sprint 2 fictif : lancé le 01/10 à 9 h (Paris), fin prévue le 14/10, données arrêtées au 10/10. */
const START = '2026-10-01T07:00:00.000Z';
const NOW = '2026-10-10T10:00:00.000Z';
const labels = TICKET_STATUS_LABELS;

function sprint(id: number, o: Partial<Sprint> = {}): Sprint {
  return { id, name: `Sprint ${id}`, goal: '', startDate: '', endDate: '', state: 'future', startedAt: null, completedAt: null, createdAt: '2026-09-01T00:00:00.000Z', createdBy: 'a', updatedAt: '', updatedBy: '', ...o };
}
const s1 = sprint(1, { state: 'closed', startDate: '2026-09-17', endDate: '2026-09-30', startedAt: '2026-09-17T07:00:00.000Z', completedAt: '2026-09-30T16:00:00.000Z' });
const s2 = sprint(2, { state: 'active', goal: 'Ouvrir le portail', startDate: '2026-10-01', endDate: '2026-10-14', startedAt: START });
const s3 = sprint(3);

let n = 0;
function ticket(o: Partial<TicketView>): TicketView {
  n++;
  return {
    id: `t${n}`,
    number: n,
    title: `Ticket ${n}`,
    details: '',
    status: 'a_faire',
    sprintId: 2,
    assigneeId: 'alice@x.fr',
    assignee: 'Alice Martin',
    dueDate: '',
    done: o.status === 'termine',
    doneAt: '',
    statusChanges: [],
    sprintChanges: [{ at: '2026-09-25T08:00:00.000Z', from: null, to: 2 }],
    createdAt: '2026-09-01T08:00:00.000Z',
    createdBy: 'a',
    updatedAt: '',
    updatedBy: '',
    projectId: 'p1',
    projectName: 'Portail',
    ...o,
  };
}

const tickets: TicketView[] = [
  // T-1 : reporté du sprint 1 à sa clôture, terminé le 05/10.
  ticket({
    status: 'termine',
    sprintChanges: [
      { at: '2026-09-10T08:00:00.000Z', from: null, to: 1 },
      { at: '2026-09-30T16:00:00.001Z', from: 1, to: 2 },
    ],
    statusChanges: [
      { at: '2026-09-20T08:00:00.000Z', from: 'a_faire', to: 'en_cours' },
      { at: '2026-10-05T08:00:00.000Z', from: 'en_cours', to: 'termine' },
    ],
  }),
  // T-2 : au lancement, 4 jours en attente puis en cours, échéance dépassée.
  ticket({
    assignee: 'Bruno Petit',
    assigneeId: 'bruno@x.fr',
    status: 'en_cours',
    dueDate: '2026-10-08',
    statusChanges: [
      { at: '2026-10-01T08:00:00.000Z', from: 'a_faire', to: 'attente' },
      { at: '2026-10-05T08:00:00.000Z', from: 'attente', to: 'en_cours' },
    ],
  }),
  // T-3 : créé dans le sprint le 03/10, en recette.
  ticket({ status: 'recette', createdAt: '2026-10-03T08:00:00.000Z', sprintChanges: [], statusChanges: [{ at: '2026-10-06T08:00:00.000Z', from: 'a_faire', to: 'recette' }] }),
  // T-4 : retiré le 07/10 vers le sprint 3.
  ticket({ sprintId: 3, sprintChanges: [{ at: '2026-09-25T08:00:00.000Z', from: null, to: 2 }, { at: '2026-10-07T08:00:00.000Z', from: 2, to: 3 }] }),
  // T-5 : ajouté depuis le backlog le 08/10.
  ticket({ sprintChanges: [{ at: '2026-10-08T08:00:00.000Z', from: null, to: 2 }] }),
  // T-6 : backlog, à échéance avant la fin du sprint.
  ticket({ sprintId: null, sprintChanges: [], dueDate: '2026-10-12', assignee: '', assigneeId: '' }),
  // T-7 : jamais dans le sprint 2.
  ticket({ sprintId: 3, sprintChanges: [] }),
];
const names = { 1: 'Sprint 1', 2: 'Sprint 2', 3: 'Sprint 3' };

describe('revue de sprint', () => {
  const r = buildSprintReport({ sprint: s2, tickets, sprintNames: names, now: NOW, labels });

  it('retrouve le périmètre et les mouvements à partir de l’historique', () => {
    expect(r.issues.map((i) => `${i.key} ${movementLabel(i.movement)}`)).toEqual([
      'T-1 Reporté de Sprint 1',
      'T-3 Créé le 03/10',
      'T-2 Au lancement',
      'T-5 Ajouté le 08/10',
      'T-4 Retiré le 07/10 → Sprint 3',
    ]);
    expect(r.counts).toMatchObject({ total: 5, active: 4, removed: 1, atStart: 3, added: 2, done: 1, recette: 1, overdue: 1 });
    expect(r.byStatus.filter((g) => g.count).map((g) => `${g.status}:${g.count}`)).toEqual(['termine:1', 'recette:1', 'en_cours:1', 'a_faire:1']);
    expect(r.team).toEqual(['Alice Martin', 'Bruno Petit']);
    expect(r.issues.find((i) => i.key === 'T-1')).toMatchObject({ doneDay: '2026-10-05', status: 'termine' });
    expect(r.issues.find((i) => i.key === 'T-2')!.waitingDays).toBe(4);
    expect(r).toMatchObject({ startDay: '2026-10-01', asOfDay: '2026-10-10', elapsedDays: 9, plannedDays: 13, medianCloseDays: 4 });
  });

  it('suit le périmètre jour par jour et détecte les points d’attention', () => {
    const day = (d: string) => r.timeline.find((x) => x.day === d)!;
    expect(day('2026-10-01')).toMatchObject({ active: 3, done: 0 });
    expect(day('2026-10-03')).toMatchObject({ active: 4, events: ['+ T-3'] });
    expect(day('2026-10-07')).toMatchObject({ active: 3, done: 1, events: ['− T-4'] });
    expect(r.attention.map((a) => a.title)).toEqual(['T-2 Ticket 2', 'Ajouts en cours de sprint', 'Dépendances et attentes', 'Sorti du sprint : T-4']);
    expect(r.attention[0]!.text).toBe('En cours, échéance du 08/10 dépassée de 2 jours.');
  });

  it('arrête les chiffres d’un sprint clos avant le report de ses tickets', () => {
    const closed = buildSprintReport({ sprint: s1, tickets, sprintNames: names, now: NOW, labels });
    expect(closed.issues.map((i) => [i.key, i.active, i.status])).toEqual([['T-1', true, 'en_cours']]);
    expect(closed.asOf).toBe(s1.completedAt);
  });

  it('résume les chiffres en Markdown pour l’IA, avec les libellés du paramétrage', () => {
    const md = sprintReportToMarkdown(r, { ...labels, recette: 'En validation' });
    expect(md).toContain('# Sprint 2 (en cours)\nObjectif du sprint : Ouvrir le portail');
    expect(md).toContain('- T-2 « Ticket 2 » [Portail] — Bruno Petit · En cours · Au lancement · échéance 08/10 DÉPASSÉE');
    expect(md).toContain('avec « En validation » : 2 / 4');
    expect(md).not.toContain('SP');
  });
});

describe('préparation de sprint', () => {
  const p = buildSprintPreparation({ sprint: s3, tickets, sprints: [s1, s2, s3], history: [{ name: 'Sprint 1', done: 1, active: 3 }], now: NOW, labels });

  it('liste les tickets prévus, les reports probables et le backlog', () => {
    expect(p.planned.map((i) => i.key)).toEqual(['T-4', 'T-7']);
    expect(p.carryOverFrom).toBe('Sprint 2');
    expect(p.carryOver.map((i) => i.key)).toEqual(['T-2', 'T-3', 'T-5']);
    expect(p.backlog.map((i) => `${i.key} ${i.assignee}`)).toEqual(['T-6 Non assigné']);
    expect(p.velocity).toBe(1);
    expect(p.alerts.map((a) => a.title)).toEqual(['Objectif non défini', 'Dates à fixer', 'Beaucoup de tickets', 'Reports probables du Sprint 2']);
  });

  it('signale les échéances restées au backlog', () => {
    const p2 = buildSprintPreparation({ sprint: s2, tickets, sprints: [s1, s2, s3], history: [], now: NOW, labels });
    expect(p2.carryOverFrom).toBeNull();
    expect(p2.alerts.map((a) => a.title)).toContain('Échéances restées au backlog');
    expect(sprintPreparationToMarkdown(p2, labels)).toContain('## Backlog : 1 ticket(s) les plus urgents sur 1 ouverts\n- T-6 « Ticket 6 » [Portail] — Non assigné · À faire · échéance 12/10');
  });
});

describe('tickets enregistrés avant les sprints', () => {
  it('déduit le statut des anciens formats', () => {
    expect(normalizeTaskRecord({ title: 'a', done: true })).toMatchObject({ status: 'termine', done: true, sprintId: null, number: 0, statusChanges: [] });
    expect(normalizeTaskRecord({ title: 'b', done: false })).toMatchObject({ status: 'a_faire', done: false });
    expect(normalizeTaskRecord({ title: 'c', status: 'bloque', priority: 'haute' })).toMatchObject({ status: 'attente', done: false, priority: 'haute' });
    expect(normalizeTaskRecord({ title: 'c', status: 'fait' })).toMatchObject({ priority: 'normale' });
    expect(normalizeTaskRecord({ title: 'c', priority: 'inconnue' })).toMatchObject({ priority: 'normale' });
    expect(normalizeTaskRecord({ title: 'd', status: 'recette', sprintId: 4, number: 9 })).toMatchObject({ status: 'recette', sprintId: 4, number: 9 });
  });
});

describe('fonds conditionnels des cartes', () => {
  const today = '2026-10-10';
  const rules: CardRule[] = [
    { kind: 'retard', value: '', days: 0, color: 'rouge' },
    { kind: 'echeance', value: '', days: 3, color: 'orange' },
    { kind: 'immobile', value: '', days: 5, color: 'gris' },
    { kind: 'responsable', value: '', days: 0, color: 'vert' }, // incomplète : ignorée
    { kind: 'projet', value: 'p2', days: 0, color: 'bleu' },
    { kind: 'sans_responsable', value: '', days: 0, color: 'violet' },
    { kind: 'sans_desk', value: '', days: 0, color: 'jaune' },
  ];
  const base = ticket({ projectId: 'p1', deskId: '48213', statusChanges: [{ at: '2026-10-08T08:00:00.000Z', from: 'a_faire', to: 'en_cours' }] });

  it('applique la première règle qui correspond', () => {
    expect(cardColor(rules, { ...base, dueDate: '2026-10-09' }, today)).toBe('rouge');
    expect(cardColor(rules, { ...base, dueDate: '2026-10-13' }, today)).toBe('orange');
    expect(cardColor(rules, { ...base, dueDate: '2026-10-14' }, today)).toBeNull();
    expect(cardColor(rules, { ...base, statusChanges: [{ at: '2026-10-04T08:00:00.000Z', from: 'a_faire', to: 'en_cours' }] }, today)).toBe('gris');
    expect(cardColor(rules, { ...base, projectId: 'p2' }, today)).toBe('bleu');
    expect(cardColor(rules, { ...base, assigneeId: '' }, today)).toBe('violet');
    expect(cardColor(rules, { ...base, deskId: '' }, today)).toBe('jaune');
    // Un ticket terminé n'est jamais « en retard ».
    expect(cardColor(rules.slice(0, 1), { ...base, done: true, status: 'termine', dueDate: '2026-10-01' }, today)).toBeNull();
  });

  it('décrit les règles pour la légende', () => {
    const names = { project: () => 'Paie', user: () => 'Alice' };
    expect(rules.map((r) => describeCardRule(r, names))).toEqual([
      'Échéance dépassée',
      'Échéance dans les 3 jours',
      'Même statut depuis plus de 5 jours',
      'Responsable : ?',
      'Projet : Paie',
      'Sans responsable du hub (personne extérieure)',
      'Sans ticket Desk',
    ]);
  });
});

describe('types de tickets', () => {
  it('propose « [TYPE] - Nom du projet » et change le type d’un titre retouché', () => {
    expect(ticketTypeTitle('Dev', 'Migration Coliéco')).toBe('[DEV] - Migration Coliéco');
    expect(ticketTypeTitle('Recette')).toBe('[RECETTE] - ');
    expect(withTicketType('[DEV] - Migration Coliéco : écran des tarifs', 'Recette')).toBe('[RECETTE] - Migration Coliéco : écran des tarifs');
    expect(withTicketType('Écran des tarifs', 'MEP')).toBe('[MEP] - Écran des tarifs');
  });
});
