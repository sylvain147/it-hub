/**
 * Jira de démonstration (site « demo », local et tests uniquement) : imite les réponses de l'API Jira Cloud
 * pour un projet fictif « TC » (tableau Scrum, trois sprints). Données entièrement inventées.
 */

const SPRINT_FIELD = 'customfield_10020';
const POINTS_FIELD = 'customfield_10016';
const DESK_FIELD = 'customfield_10050';

const SPRINTS = [
  { id: 41, name: 'TC Sprint 3', state: 'closed', startDate: '2026-09-23T07:00:00.000Z', endDate: '2026-10-13T16:00:00.000Z', completeDate: '2026-10-14T06:30:00.000Z', goal: 'Paiements et relances', originBoardId: 7 },
  { id: 42, name: 'TC Sprint 4', state: 'active', startDate: '2026-10-14T07:00:00.000Z', endDate: '2026-11-04T17:00:00.000Z', goal: 'Lancement de l’offre ESS et fiabilisation des commandes', originBoardId: 7 },
  { id: 43, name: 'TC Sprint 5', state: 'future', goal: '', originBoardId: 7 },
] as const;
const sprintById = new Map<number, (typeof SPRINTS)[number]>(SPRINTS.map((s) => [s.id, s]));

const STATUSES: Record<string, 'new' | 'indeterminate' | 'done'> = {
  Backlog: 'new',
  'À faire': 'new',
  'En cours': 'indeterminate',
  'Attente prestataire': 'indeterminate',
  'En recette': 'indeterminate',
  Clôturé: 'done',
};

interface DemoIssue {
  key: string;
  summary: string;
  assignee: string;
  priority?: string;
  points?: number;
  due?: string;
  created: string;
  /** [date, sprints avant, sprints après] */
  sprints: [string, number[], number[]][];
  /** Sprints actuels si aucun changement (ticket créé directement dans un sprint). */
  initialSprints?: number[];
  /** [date, statut] successifs (le premier statut est « À faire »). */
  statuses: [string, string][];
  resolved?: string;
  spentHours?: number;
  remainingHours?: number;
  desk?: string;
}

const A = 'Alice Martin';
const B = 'Bruno Petit';
const C = 'Chloé Durand';
const S3_TO_S4: [string, number[], number[]] = ['2026-10-14T06:30:00.000Z', [41], [41, 42]];

const ISSUES: DemoIssue[] = [
  // Sprint 3 : livrés dans le sprint
  { key: 'TC-320', summary: 'Correction de l’export comptable mensuel', assignee: A, points: 2, created: '2026-09-10T08:00:00.000Z', sprints: [['2026-09-20T08:00:00.000Z', [], [41]]], statuses: [['2026-09-24T08:00:00.000Z', 'En cours'], ['2026-10-08T15:00:00.000Z', 'Clôturé']], resolved: '2026-10-08T15:00:00.000Z' },
  { key: 'TC-322', summary: 'Mise à jour des conditions générales de vente', assignee: B, points: 1, created: '2026-09-12T08:00:00.000Z', sprints: [['2026-09-20T08:00:00.000Z', [], [41]]], statuses: [['2026-09-29T08:00:00.000Z', 'En cours'], ['2026-10-10T10:00:00.000Z', 'Clôturé']], resolved: '2026-10-10T10:00:00.000Z' },
  // Reportés du sprint 3 au sprint 4
  {
    key: 'TC-329', summary: 'Blocage de la saisie d’un e-mail invalide', assignee: A, points: 1.5, created: '2026-09-15T08:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4],
    statuses: [['2026-09-25T08:00:00.000Z', 'En cours'], ['2026-10-02T08:00:00.000Z', 'Attente prestataire'], ['2026-10-16T08:00:00.000Z', 'En cours'], ['2026-10-28T09:00:00.000Z', 'Clôturé']],
    resolved: '2026-10-20T09:00:00.000Z', remainingHours: 12, desk: '11373',
  },
  {
    key: 'TC-333', summary: 'Délai d’encaissement des chèques ramené de 90 à 50 jours', assignee: A, points: 0.5, due: '2026-10-28', created: '2026-09-16T08:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4],
    statuses: [['2026-10-06T08:00:00.000Z', 'En cours'], ['2026-10-23T14:00:00.000Z', 'Clôturé']], resolved: '2026-10-23T14:00:00.000Z', remainingHours: 21,
  },
  {
    key: 'TC-336', summary: 'Rapprochement automatique des paiements PayPal', assignee: B, due: '2026-10-19', created: '2026-09-16T09:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4],
    statuses: [['2026-09-30T08:00:00.000Z', 'En cours'], ['2026-10-15T08:00:00.000Z', 'Attente prestataire'], ['2026-10-21T08:00:00.000Z', 'En cours'], ['2026-10-27T16:00:00.000Z', 'Clôturé']],
    resolved: '2026-10-19T16:00:00.000Z', spentHours: 42, desk: '8720',
  },
  {
    key: 'TC-352', summary: 'Alertes en cas de retard des fichiers de facturation', assignee: B, due: '2026-10-19', created: '2026-09-18T08:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4],
    statuses: [['2026-10-09T08:00:00.000Z', 'En cours'], ['2026-10-27T11:00:00.000Z', 'Clôturé']], resolved: '2026-10-19T11:00:00.000Z',
  },
  {
    key: 'TC-354', summary: 'Opt-in SMS vidé quand l’opt-in e-mail est vide', assignee: B, due: '2026-10-16', created: '2026-09-18T09:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4],
    statuses: [['2026-10-12T08:00:00.000Z', 'Attente prestataire'], ['2026-10-17T08:00:00.000Z', 'En cours'], ['2026-10-22T10:00:00.000Z', 'Clôturé']], resolved: '2026-10-14T10:00:00.000Z', spentHours: 7,
  },
  {
    key: 'TC-356', summary: 'Reprise et déploiement des offres conjointes', assignee: B, priority: 'High', due: '2026-10-02', created: '2026-09-19T08:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4],
    statuses: [['2026-09-28T08:00:00.000Z', 'En cours'], ['2026-10-05T08:00:00.000Z', 'Attente prestataire'], ['2026-10-19T08:00:00.000Z', 'En cours'], ['2026-10-28T08:00:00.000Z', 'Clôturé']], resolved: '2026-10-20T08:00:00.000Z',
  },
  {
    key: 'TC-330', summary: 'Export des statistiques de la page de remerciement', assignee: A, due: '2026-10-26', created: '2026-09-15T09:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4],
    statuses: [['2026-10-20T08:00:00.000Z', 'En cours']],
  },
  {
    key: 'TC-355', summary: 'Champ e-mail ou téléphone obligatoire pour le retrait en magasin', assignee: B, priority: 'High', points: 1, created: '2026-09-18T10:00:00.000Z',
    sprints: [['2026-09-20T08:00:00.000Z', [], [41]], S3_TO_S4, ['2026-10-20T09:00:00.000Z', [41, 42], [41, 43]]],
    statuses: [],
  },
  // Lancés avec le sprint 4
  {
    key: 'TC-367', summary: '[ESS] Développement', assignee: A, points: 5, due: '2026-10-30', created: '2026-10-13T09:00:00.000Z', initialSprints: [42],
    sprints: [],
    statuses: [['2026-10-27T08:00:00.000Z', 'En cours']],
  },
  // Ajoutés en cours de sprint
  {
    key: 'TC-365', summary: 'Activation automatique de l’opt-in à J+7 pour les abonnés', assignee: B, points: 0.5, created: '2026-10-08T08:00:00.000Z',
    sprints: [['2026-10-16T08:00:00.000Z', [], [42]]],
    statuses: [['2026-10-17T08:00:00.000Z', 'Attente prestataire'], ['2026-10-29T08:00:00.000Z', 'En cours']],
  },
  {
    key: 'TC-361', summary: 'Paiement Ingenico direct', assignee: C, points: 1, created: '2026-10-01T08:00:00.000Z',
    sprints: [['2026-10-20T10:00:00.000Z', [], [42]], ['2026-11-04T09:00:00.000Z', [42], []]],
    statuses: [['2026-10-25T08:00:00.000Z', 'Attente prestataire'], ['2026-11-04T09:00:00.000Z', 'Backlog']],
  },
  {
    key: 'TC-375', summary: 'Bug import commande marketplace', assignee: A, created: '2026-10-26T09:00:00.000Z', initialSprints: [42],
    sprints: [],
    statuses: [['2026-10-27T08:00:00.000Z', 'En cours'], ['2026-11-02T10:00:00.000Z', 'En recette']], desk: '11375',
  },
  {
    key: 'TC-332', summary: 'Mise en place d’une offre premium sur la boutique', assignee: A, points: 1, due: '2026-11-03', created: '2026-09-15T10:00:00.000Z',
    sprints: [['2026-11-03T08:00:00.000Z', [], [42]]],
    statuses: [['2026-11-03T09:00:00.000Z', 'En cours'], ['2026-11-04T15:00:00.000Z', 'En recette']],
  },
  {
    key: 'TC-344', summary: 'Suppression automatique des commandes téléphone non validées après 7 jours', assignee: B, created: '2026-09-17T08:00:00.000Z',
    sprints: [['2026-11-04T08:00:00.000Z', [], [42]]],
    statuses: [['2026-11-04T08:30:00.000Z', 'En cours'], ['2026-11-04T16:00:00.000Z', 'En recette']],
  },
];

/** Format de date Jira : « 2026-10-14T09:00:00.000+0200 » (ici toujours en UTC). */
const jd = (iso: string) => iso.replace('Z', '+0000');
const sprintName = (id: number) => sprintById.get(id)?.name ?? `Sprint ${id}`;

function currentSprints(i: DemoIssue): number[] {
  return i.sprints.length ? i.sprints.at(-1)![2] : (i.initialSprints ?? []);
}

function histories(i: DemoIssue) {
  const h: { created: string; items: Record<string, string | null>[] }[] = [];
  for (const [at, from, to] of i.sprints) {
    h.push({
      created: jd(at),
      items: [{ field: 'Sprint', fieldId: SPRINT_FIELD, from: from.join(', ') || null, fromString: from.map(sprintName).join(', ') || null, to: to.join(', ') || null, toString: to.map(sprintName).join(', ') || null }],
    });
  }
  let prev = 'À faire';
  for (const [at, status] of i.statuses) {
    h.push({ created: jd(at), items: [{ field: 'status', fieldId: 'status', from: null, fromString: prev, to: null, toString: status }] });
    prev = status;
  }
  return h.sort((a, b) => a.created.localeCompare(b.created));
}

function toJira(i: DemoIssue) {
  const status = i.statuses.at(-1)?.[1] ?? 'À faire';
  const h = histories(i);
  return {
    key: i.key,
    fields: {
      summary: i.summary,
      issuetype: { name: 'Feature' },
      priority: { name: i.priority ?? 'Medium' },
      assignee: { displayName: i.assignee },
      status: { name: status, statusCategory: { key: STATUSES[status] } },
      duedate: i.due ?? null,
      created: jd(i.created),
      resolutiondate: i.resolved ? jd(i.resolved) : null,
      timespent: i.spentHours ? i.spentHours * 3600 : null,
      timeestimate: i.remainingHours ? i.remainingHours * 3600 : status === 'Clôturé' ? 0 : null,
      [POINTS_FIELD]: i.points ?? null,
      [DESK_FIELD]: i.desk ?? null,
      [SPRINT_FIELD]: currentSprints(i).map((id) => ({ id, name: sprintName(id), state: sprintById.get(id)?.state ?? 'future', boardId: 7 })),
    },
    changelog: { histories: h, total: h.length, maxResults: h.length },
  };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const notFoundRes = () => json({ errorMessages: ['Introuvable'] }, 404);

export async function demoJiraFetch(url: string, init: { method: string; body?: string }): Promise<Response> {
  const u = new URL(url);
  const p = u.pathname;
  const q = u.searchParams;
  if (p === '/rest/api/3/myself') return json({ displayName: 'Compte de démonstration', emailAddress: 'demo@example.com' });
  if (p === '/rest/api/3/field') {
    return json([
      { id: 'summary', name: 'Résumé', custom: false, schema: { type: 'string' } },
      { id: POINTS_FIELD, name: 'Story point estimate', custom: true, schema: { type: 'number', custom: 'com.pyxis.greenhopper.jira:jsw-story-points' } },
      { id: SPRINT_FIELD, name: 'Sprint', custom: true, schema: { type: 'array', custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
      { id: DESK_FIELD, name: 'Réf Ticket Desk', custom: true, schema: { type: 'string' } },
      { id: 'customfield_10060', name: 'Équipe', custom: true, schema: { type: 'option' } },
    ]);
  }
  if (p === '/rest/api/3/status') return json(Object.entries(STATUSES).map(([name, key]) => ({ name, statusCategory: { key } })));
  if (p === '/rest/agile/1.0/board') {
    const key = (q.get('projectKeyOrId') ?? '').toUpperCase();
    const boards = !key || key === 'TC' ? [{ id: 7, name: 'Tableau TC', type: 'scrum', location: { projectKey: 'TC' } }] : [];
    return json({ values: boards, isLast: true });
  }
  if (p === '/rest/agile/1.0/board/7/sprint') return json({ values: SPRINTS, isLast: true });
  let m = /^\/rest\/agile\/1\.0\/sprint\/(\d+)$/.exec(p);
  if (m) return sprintById.has(Number(m[1])) ? json(sprintById.get(Number(m[1]))) : notFoundRes();
  if (p === '/rest/greenhopper/1.0/rapid/charts/sprintreport') {
    const sid = Number(q.get('sprintId'));
    const punted = ISSUES.filter((i) => i.sprints.some(([, from, to]) => from.includes(sid) && !to.includes(sid)) && !currentSprints(i).includes(sid));
    return json({ contents: { puntedIssues: punted.map((i) => ({ key: i.key })) } });
  }
  if (p === '/rest/api/3/search/jql' && init.method === 'POST') {
    const jql = String((JSON.parse(init.body ?? '{}') as { jql?: string }).jql ?? '');
    const sid = Number(/sprint = (\d+)/.exec(jql)?.[1]);
    const keys = new Set([...(/key in \(([^)]*)\)/.exec(jql)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    return json({ issues: ISSUES.filter((i) => currentSprints(i).includes(sid) || keys.has(i.key)).map(toJira), isLast: true });
  }
  m = /^\/rest\/api\/3\/issue\/([^/]+)\/changelog$/.exec(p);
  if (m) {
    const issue = ISSUES.find((i) => i.key === decodeURIComponent(m![1]!));
    return issue ? json({ values: histories(issue), isLast: true, total: histories(issue).length }) : notFoundRes();
  }
  return notFoundRes();
}
