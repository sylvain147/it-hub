import { z } from 'zod';
import { PRIORITIES, type Priority } from './project.js';
import { parseCsv } from './tma/desk.js';

/**
 * Idées d'amélioration (ERP, outils, process…) : la liste de l'équipe, partagée, chaque idée avec une priorité.
 * Une idée retenue peut devenir un ticket (backlog d'un projet ou hors projet), sur action explicite.
 * Une liste tenue ailleurs (Notion) s'importe par un export CSV ou un copier-coller, lu dans le navigateur.
 */

export const IDEA_STATUSES = ['nouvelle', 'retenue', 'en_cours', 'realisee', 'ecartee'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];
export const IDEA_STATUS_LABELS: Record<IdeaStatus, string> = {
  nouvelle: 'Nouvelle',
  retenue: 'Retenue',
  en_cours: 'En cours',
  realisee: 'Réalisée',
  ecartee: 'Écartée',
};
/** Idées closes (masquées par défaut). */
export const CLOSED_IDEA_STATUSES: IdeaStatus[] = ['realisee', 'ecartee'];

/** Domaine proposé par défaut (la liste d'origine : « Idées amélioration ERP »). */
export const DEFAULT_IDEA_DOMAIN = 'ERP';

export const ideaInputSchema = z.object({
  title: z.string().trim().min(1, 'L’idée doit avoir un intitulé').max(300),
  /** Description en Markdown. */
  details: z.string().max(10_000).default(''),
  priority: z.enum(PRIORITIES).default('normale'),
  status: z.enum(IDEA_STATUSES).default('nouvelle'),
  /** Domaine concerné (ERP, intranet…), texte libre. */
  domain: z.string().trim().max(60).default(DEFAULT_IDEA_DOMAIN),
  /** Projet concerné (vide : aucun). */
  projectId: z.string().max(100).default(''),
});
export type IdeaInput = z.input<typeof ideaInputSchema>;

export interface Idea extends z.infer<typeof ideaInputSchema> {
  id: string;
  /** Utilisateurs qui soutiennent l'idée (+1). */
  votes: string[];
  /** Ticket créé à partir de l'idée. */
  ticket: { projectId: string; ticketId: string; number: number } | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export const updateIdeaBody = ideaInputSchema.partial();
export type UpdateIdeaBody = z.input<typeof updateIdeaBody>;

export const voteIdeaBody = z.object({ vote: z.boolean() });

export const importIdeasBody = z.object({ ideas: z.array(ideaInputSchema).min(1, 'Aucune idée à importer').max(500, '500 idées au plus par import') });
export type ImportIdeasBody = z.input<typeof importIdeasBody>;

export const ideaTicketBody = z.object({
  /** Projet du ticket ; vide : celui de l'idée, sinon hors projet. */
  projectId: z.string().max(100).default(''),
});

/** Tri : priorité la plus haute, puis le plus de soutiens, puis la plus ancienne. */
export function byIdeaPriority(a: Idea, b: Idea): number {
  return PRIORITIES.indexOf(b.priority) - PRIORITIES.indexOf(a.priority) || b.votes.length - a.votes.length || a.createdAt.localeCompare(b.createdAt);
}

// ---------------------------------------------------------------------------
// Import d'une liste Notion (export CSV ou copier-coller d'un tableau / d'une liste)
// ---------------------------------------------------------------------------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/** Priorité d'après le texte Notion (« Haute », « P1 », « 🔥🔥 », « ⭐⭐⭐ »…) ; null : non reconnue. */
export function priorityFromText(text: string): Priority | null {
  const t = norm(text);
  if (!t) return null;
  const stars = [...text].filter((c) => c === '⭐' || c === '★' || c === '🔥').length;
  if (stars && !/[a-z]/.test(t)) return stars >= 4 ? 'critique' : stars === 3 ? 'haute' : stars === 2 ? 'normale' : 'basse';
  if (/critique|urgent|bloquant|\bp0\b|tres (haute|elevee)|maximale/.test(t)) return 'critique';
  if (/haute|elevee?|high|importante?|\bp1\b|forte/.test(t)) return 'haute';
  if (/basse|faible|low|\bp3\b|\bp4\b|mineure/.test(t)) return 'basse';
  if (/moyen|normal|medium|\bp2\b/.test(t)) return 'normale';
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n >= 5 ? 'critique' : n === 4 ? 'haute' : n === 3 ? 'normale' : 'basse';
  return null;
}

/** Statut d'après le texte Notion ; une case cochée (« Yes », « Oui ») : réalisée. */
export function statusFromText(text: string): IdeaStatus | null {
  const t = norm(text);
  if (!t) return null;
  if (/^(yes|oui|true|x|\[x\])$|fait|done|termine|realise|livre|complete/.test(t)) return 'realisee';
  if (/en cours|in progress|commence|demarre/.test(t)) return 'en_cours';
  if (/abandon|ecart|refus|rejet|won.?t|annul/.test(t)) return 'ecartee';
  if (/retenu|valide|accepte|a faire|todo|to do|planifie/.test(t)) return 'retenue';
  if (/^(no|non|false)$|nouveau|nouvelle|idee|a etudier|backlog|not started|pas commence/.test(t)) return 'nouvelle';
  return null;
}

const TITLE_COLUMNS = /^(name|nom|titre|title|idee|intitule|sujet|amelioration)/;
const PRIORITY_COLUMNS = /priorit|importance|urgence/;
const STATUS_COLUMNS = /^(statut|status|etat|etape|fait|done|termine)/;
const DETAILS_COLUMNS = /^(description|details?|notes?|commentaires?|contexte|besoin)/;
const DOMAIN_COLUMNS = /^(domaine|module|perimetre|categorie|category|theme|application)/;
/** Colonnes de Notion sans intérêt ici. */
const IGNORED_COLUMNS = /^(created|cree|date de creation|last edited|derniere modification|modifie)/;

export interface IdeaImportResult {
  ideas: (z.infer<typeof ideaInputSchema> & { line: number })[];
  /** Colonnes reconnues (pour l'aperçu). */
  columns: { title: string; priority: string | null; status: string | null; details: string | null; domain: string | null };
  /** Valeurs de priorité non reconnues (les idées restent en « normale »). */
  unknownPriorities: string[];
}

/** Ligne d'une liste à puces / à cocher (`- [ ] Idée`, `* Idée`, `1. Idée`). */
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+(?:\[( |x|X)\]\s+)?(.+)$/;

/**
 * Lit une liste d'idées exportée de Notion : CSV (« Exporter → Markdown & CSV »), tableau copié-collé (tabulations)
 * ou simple liste (puces, cases à cocher, une idée par ligne). Rien n'est envoyé : le résultat sert d'aperçu.
 */
export function parseIdeasImport(text: string, domain = DEFAULT_IDEA_DOMAIN): IdeaImportResult {
  const clean = text.replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.trim());
  const empty: IdeaImportResult = { ideas: [], columns: { title: 'Ligne', priority: null, status: null, details: null, domain: null }, unknownPriorities: [] };
  if (!lines.length) return empty;
  const first = lines[0]!;
  const tabular = first.includes('\t') || (/[,;]/.test(first) && !LIST_LINE.test(first) && TITLE_COLUMNS.test(norm(first.replace(/^"/, ''))));
  const base = { details: '', priority: 'normale' as Priority, status: 'nouvelle' as IdeaStatus, domain, projectId: '' };

  if (!tabular) {
    // Liste simple : une idée par ligne ; une priorité éventuelle entre parenthèses ou après « — ».
    const ideas = lines.flatMap((l, i) => {
      const m = LIST_LINE.exec(l);
      const done = m?.[1]?.toLowerCase() === 'x';
      let title = (m ? m[2]! : l).trim().replace(/^#+\s*/, '');
      if (!title) return [];
      let priority: Priority = 'normale';
      const tag = /\s*(?:\(([^)]+)\)|[—–-]\s*([^—–-]+))$/.exec(title);
      const p = tag ? priorityFromText(tag[1] ?? tag[2] ?? '') : null;
      if (tag && p) {
        priority = p;
        title = title.slice(0, tag.index).trim();
      } else {
        const lead = /^([⭐★🔥]+)\s*/u.exec(title);
        if (lead) {
          priority = priorityFromText(lead[1]!) ?? 'normale';
          title = title.slice(lead[0].length);
        }
      }
      return [{ ...base, title: title.slice(0, 300), priority, status: done ? ('realisee' as const) : ('nouvelle' as const), line: i + 1 }];
    });
    return { ...empty, ideas };
  }

  const rows = parseCsv(clean, first.includes('\t') ? '\t' : undefined);
  const header = rows[0]!.map((h) => norm(h));
  const find = (re: RegExp, except: number[] = []) => {
    const i = header.findIndex((h, k) => !except.includes(k) && re.test(h));
    return i < 0 ? null : i;
  };
  const titleCol = find(TITLE_COLUMNS) ?? 0;
  const prioCol = find(PRIORITY_COLUMNS, [titleCol]);
  const statusCol = find(STATUS_COLUMNS, [titleCol, prioCol ?? -1]);
  const detailsCol = find(DETAILS_COLUMNS, [titleCol]);
  const domainCol = find(DOMAIN_COLUMNS, [titleCol]);
  const used = [titleCol, prioCol, statusCol, detailsCol, domainCol].filter((x): x is number => x !== null);
  const extras = header.map((h, i) => ({ h, i })).filter(({ h, i }) => !used.includes(i) && h && !IGNORED_COLUMNS.test(h));
  const unknown = new Set<string>();
  const ideas = rows.slice(1).flatMap((r, k) => {
    const cell = (i: number | null) => (i === null ? '' : (r[i] ?? '').trim());
    const title = cell(titleCol);
    if (!title) return [];
    const p = cell(prioCol);
    const priority = priorityFromText(p);
    if (p && !priority) unknown.add(p);
    // Les autres colonnes remplies sont gardées dans la description.
    const more = extras.map(({ i }) => ({ label: rows[0]![i]!.trim(), v: cell(i) })).filter((x) => x.v);
    const details = [cell(detailsCol), ...more.map((x) => `**${x.label}** : ${x.v}`)].filter(Boolean).join('\n\n');
    return [
      {
        ...base,
        title: title.slice(0, 300),
        details: details.slice(0, 10_000),
        priority: priority ?? 'normale',
        status: statusFromText(cell(statusCol)) ?? 'nouvelle',
        domain: cell(domainCol).slice(0, 60) || domain,
        line: k + 2,
      },
    ];
  });
  const label = (i: number | null) => (i === null ? null : rows[0]![i]!.trim());
  return {
    ideas,
    columns: { title: label(titleCol)!, priority: label(prioCol), status: label(statusCol), details: label(detailsCol), domain: label(domainCol) },
    unknownPriorities: [...unknown],
  };
}
