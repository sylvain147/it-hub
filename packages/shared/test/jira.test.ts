import { describe, expect, it } from 'vitest';
import { buildSprintReport, movementLabel, normalizeJiraSite, sprintReportToMarkdown, statusGroup, type SprintIssue, type SprintSnapshot } from '../src/index.js';

/** Sprint fictif : lancé le 01/10 à 9 h (Paris), fin prévue le 15/10, données arrêtées au 10/10. */
const START = '2026-10-01T07:00:00.000Z';

function issue(key: string, o: Partial<SprintIssue>): SprintIssue {
  return {
    key,
    summary: `Ticket ${key}`,
    type: 'Story',
    priority: 'Medium',
    assignee: 'Alice Martin',
    status: 'À faire',
    storyPoints: null,
    dueDate: '',
    created: '2026-09-01T08:00:00.000Z',
    resolutionDate: null,
    timeSpentSeconds: null,
    remainingSeconds: null,
    deskRef: '',
    sprints: [10],
    sprintChanges: [{ at: '2026-09-20T08:00:00.000Z', from: [], to: [10] }],
    statusChanges: [],
    ...o,
  };
}

const snapshot: SprintSnapshot = {
  site: 'https://exemple.atlassian.net',
  sprint: { id: 10, name: 'Sprint 2', state: 'active', startDate: START, endDate: '2026-10-15T15:00:00.000Z', completeDate: null, goal: '', boardId: 1 },
  syncedAt: '2026-10-10T10:00:00.000Z',
  statusCategories: { 'À faire': 'new', 'En cours': 'indeterminate', 'En recette': 'indeterminate', 'Attente client': 'indeterminate', Terminé: 'done' },
  sprintNames: { 9: 'Sprint 1', 10: 'Sprint 2', 11: 'Sprint 3' },
  hasStoryPoints: true,
  issues: [
    // Reporté du sprint 1, terminé le 05/10 (résolution saisie le 02/10), 3 SP, reste à faire non soldé.
    issue('X-1', {
      storyPoints: 3,
      status: 'Terminé',
      sprints: [9, 10],
      sprintChanges: [
        { at: '2026-09-10T08:00:00.000Z', from: [], to: [9] },
        { at: '2026-09-30T16:00:00.000Z', from: [9], to: [9, 10] },
      ],
      statusChanges: [
        { at: '2026-10-02T08:00:00.000Z', from: 'À faire', to: 'En cours' },
        { at: '2026-10-05T08:00:00.000Z', from: 'En cours', to: 'Terminé' },
      ],
      resolutionDate: '2026-10-02T08:00:00.000Z',
      remainingSeconds: 7200,
      timeSpentSeconds: 3600 * 5,
    }),
    // Au lancement, en attente 4 jours puis en cours, échéance dépassée, 8 SP (gros ticket).
    issue('X-2', {
      assignee: 'Bruno Petit',
      storyPoints: 8,
      status: 'En cours',
      dueDate: '2026-10-08',
      statusChanges: [
        { at: '2026-10-02T07:00:00.000Z', from: 'À faire', to: 'Attente client' },
        { at: '2026-10-06T07:00:00.000Z', from: 'Attente client', to: 'En cours' },
      ],
    }),
    // Ajouté le 03/10, en recette depuis le 09/10, sans story points.
    issue('X-3', {
      status: 'En recette',
      sprintChanges: [{ at: '2026-10-03T08:00:00.000Z', from: [], to: [10] }],
      statusChanges: [{ at: '2026-10-09T08:00:00.000Z', from: 'À faire', to: 'En recette' }],
      deskRef: '1234',
    }),
    // Créé directement dans le sprint le 04/10 (aucun changement de sprint), type « Story » mais résumé de bug.
    issue('X-4', { summary: 'Bug sur la facture', created: '2026-10-04T08:00:00.000Z', sprintChanges: [], storyPoints: 1 }),
    // Au lancement, retiré le 06/10 vers le sprint 3.
    issue('X-5', {
      priority: 'High',
      storyPoints: 2,
      sprints: [11],
      sprintChanges: [
        { at: '2026-09-20T08:00:00.000Z', from: [], to: [10] },
        { at: '2026-10-06T08:00:00.000Z', from: [10], to: [11] },
      ],
    }),
    // Sans rapport avec ce sprint pendant la période (retiré avant le lancement).
    issue('X-6', { sprints: [], sprintChanges: [{ at: '2026-09-20T08:00:00.000Z', from: [], to: [10] }, { at: '2026-09-25T08:00:00.000Z', from: [10], to: [] }] }),
  ],
};

describe('revue de sprint Jira', () => {
  const r = buildSprintReport(snapshot);
  const byKey = Object.fromEntries(r.issues.map((i) => [i.key, i]));

  it('regroupe les statuts', () => {
    expect(statusGroup('Clôturé', 'done')).toBe('termine');
    expect(statusGroup('En recette', 'indeterminate')).toBe('recette');
    expect(statusGroup('Attente Prestataire', 'indeterminate')).toBe('attente');
    expect(statusGroup('Backlog', 'new')).toBe('a_faire');
    expect(statusGroup('Développement', 'indeterminate')).toBe('en_cours');
  });

  it('reconstitue le périmètre et les mouvements', () => {
    expect(r.issues.map((i) => i.key)).toEqual(['X-1', 'X-3', 'X-2', 'X-4', 'X-5']);
    expect(r.counts).toMatchObject({ total: 5, active: 4, removed: 1, atStart: 3, added: 2, addedDone: 0, done: 1, recette: 1, overdue: 1, withPoints: 3 });
    expect(r.points).toEqual({ active: 12, done: 3, removed: 2 });
    expect(movementLabel(byKey['X-1']!.movement)).toBe('Reporté de Sprint 1');
    expect(movementLabel(byKey['X-2']!.movement)).toBe('Au lancement');
    expect(movementLabel(byKey['X-3']!.movement)).toBe('Ajouté le 03/10');
    expect(movementLabel(byKey['X-4']!.movement)).toBe('Créé le 04/10');
    expect(movementLabel(byKey['X-5']!.movement)).toBe('Retiré le 06/10 → Sprint 3');
    expect(byKey['X-1']).toMatchObject({ group: 'termine', doneDay: '2026-10-05' });
    expect(byKey['X-3']).toMatchObject({ group: 'recette', statusSince: '2026-10-09', deskRef: '1234' });
    expect(byKey['X-2']).toMatchObject({ overdue: true, waitingDays: 4 });
  });

  it('calcule la chronologie, les délais et le temps par statut', () => {
    expect(r.startDay).toBe('2026-10-01');
    expect(r.asOfDay).toBe('2026-10-10');
    expect(r.timeline).toHaveLength(10);
    expect(r.timeline[0]).toEqual({ day: '2026-10-01', active: 3, done: 0, events: [] });
    expect(r.timeline.find((t) => t.day === '2026-10-03')).toMatchObject({ active: 4, events: ['+ X-3'] });
    expect(r.timeline.find((t) => t.day === '2026-10-06')).toMatchObject({ active: 4, done: 1, events: ['− X-5'] });
    expect(r.timeline.at(-1)).toMatchObject({ active: 4, done: 1 });
    expect(r.medianCloseDays).toBe(4);
    expect(r.lastCloseDay).toBe('2026-10-05');
    const waiting = r.timeByGroup.find((t) => t.group === 'attente')!;
    expect(waiting.days).toBe(4);
    expect(r.byAssignee[0]).toMatchObject({ assignee: 'Alice Martin', total: 3 });
    expect(r.byGroup.find((g) => g.group === 'termine')).toMatchObject({ count: 1, points: 3, statuses: ['Terminé'] });
  });

  it('signale les points d’attention et les défauts de saisie', () => {
    const titles = r.attention.map((a) => a.title);
    expect(titles).toContain('X-2 Ticket X-2');
    expect(titles).toContain('Ticket volumineux : X-2');
    expect(titles).toContain('Ajouts en cours de sprint');
    expect(titles).toContain('Sorti du sprint : X-5');
    expect(r.attention.find((a) => a.title === 'Sorti du sprint : X-5')!.level).toBe('attention'); // priorité haute
    const quality = r.dataQuality.map((a) => a.title);
    expect(quality).toContain('Tickets sans story points');
    expect(quality).toContain('Date de résolution incohérente');
    expect(quality).toContain('Reste à faire non soldé');
    expect(quality).toContain('Type unique « Story »');
  });

  it('arrête les données à la clôture d’un sprint terminé', () => {
    const closed = buildSprintReport({ ...snapshot, sprint: { ...snapshot.sprint, state: 'closed', completeDate: '2026-10-04T12:00:00.000Z' } });
    expect(closed.asOfDay).toBe('2026-10-04');
    expect(closed.counts).toMatchObject({ active: 5, removed: 0, done: 0 });
    expect(closed.issues.find((i) => i.key === 'X-1')!.status).toBe('En cours');
  });

  it('produit un Markdown compact pour l’IA', () => {
    const md = sprintReportToMarkdown(r);
    expect(md).toContain('# Sprint 2 (en cours)');
    expect(md).toContain('Clôturés : 1 / 4 (25 %)');
    expect(md).toContain('X-5 « Ticket X-5 »');
    expect(md.length).toBeLessThan(5000);
  });

  it('normalise l’adresse du site Jira Cloud', () => {
    expect(normalizeJiraSite('monentreprise')).toBe('https://monentreprise.atlassian.net');
    expect(normalizeJiraSite('https://MonEntreprise.atlassian.net/jira/software/projects/TC/boards/7')).toBe('https://monentreprise.atlassian.net');
    expect(normalizeJiraSite('http://evil.example.com')).toBeNull();
    expect(normalizeJiraSite('demo')).toBe('demo');
  });
});

describe('préparation de sprint et tâches', () => {
  it('classe les priorités Jira, en anglais comme en français', async () => {
    const { priorityRank } = await import('../src/index.js');
    expect(['Low', 'Highest', 'Medium', 'Haute', 'Lowest'].sort((a, b) => priorityRank(a) - priorityRank(b))).toEqual(['Highest', 'Haute', 'Medium', 'Low', 'Lowest']);
  });

  it('convertit les tâches enregistrées avec un statut', async () => {
    const { normalizeTaskRecord } = await import('../src/index.js');
    expect(normalizeTaskRecord({ title: 'a', status: 'fait', priority: 'haute' })).toEqual({ title: 'a', done: true });
    expect(normalizeTaskRecord({ title: 'b', status: 'bloque' })).toEqual({ title: 'b', done: false });
    expect(normalizeTaskRecord({ title: 'c', done: true })).toEqual({ title: 'c', done: true });
  });
});
