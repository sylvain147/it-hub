/**
 * Traitements IA du module « Projets ». Toujours sur action explicite de l'utilisateur.
 *
 *  - Analyse d'un compte rendu / d'une transcription (modèle rapide : c'est le volumineux) : notes structurées
 *    + propositions de tâches, jalons et risques, que l'utilisateur valide une à une.
 *  - Rapport d'avancement (modèle de rédaction) : à partir des seules données du projet, pas de document brut.
 *  - Contexte projet pour la génération d'un cahier des charges (Markdown compact, sans appel IA).
 */
import { z } from 'zod';
import {
  HEALTHS,
  HEALTH_LABELS,
  NOTE_KIND_LABELS,
  PRIORITIES,
  RISK_LEVELS,
  isJalonLate,
  isTaskOverdue,
  jalonDrift,
  projectSectionsMarkdown,
  riskScore,
  todayIso,
  type Note,
  type ProjectDetail,
  type ProjectSummary,
  type ProjectItems,
  statusLabel,
  type ListSettings,
} from '@samm/shared';
import { getLists } from '../settings/repo.js';
import { callStructured } from '../ai/llm.js';
import { DIGEST_SYSTEM, REPORT_SYSTEM } from './prompts.js';

type Ctx = { user: string; cdcId: string };

// ---------------------------------------------------------------------------
// Schémas de sortie
// ---------------------------------------------------------------------------

export const digestSchema = z.object({
  title: z.string().describe('Titre court de la réunion, ex. « Point hebdo avec Coqliqo »'),
  summary: z.string().describe('Compte rendu structuré en Markdown (sous-titres « ## », puces)'),
  decisions: z.array(z.string()).describe('Décisions prises, une phrase chacune'),
  tasks: z.array(
    z.object({
      title: z.string().describe('Action à mener, commençant par un verbe'),
      assignee: z.string().describe('Personne ou société responsable, chaîne vide si inconnue'),
      dueDate: z.string().describe('Échéance AAAA-MM-JJ, chaîne vide si inconnue'),
      priority: z.enum(PRIORITIES),
    }),
  ),
  jalons: z.array(z.object({ label: z.string(), date: z.string().describe('AAAA-MM-JJ, chaîne vide si inconnue') })),
  risks: z.array(
    z.object({
      title: z.string(),
      probability: z.enum(RISK_LEVELS),
      impact: z.enum(RISK_LEVELS),
      mitigation: z.string().describe('Parade envisagée, chaîne vide si aucune'),
    }),
  ),
});
export type Digest = z.infer<typeof digestSchema>;

export const reportSchema = z.object({
  title: z.string().describe('ex. « Rapport d’avancement du 04/11/2026 »'),
  markdown: z.string().describe('Rapport complet en Markdown'),
  suggestedHealth: z.enum(HEALTHS).describe('Météo proposée au vu des données'),
});
export type Report = z.infer<typeof reportSchema>;

// ---------------------------------------------------------------------------
// Mise en forme des données du projet (Markdown compact)
// ---------------------------------------------------------------------------

const d = (s: string) => s || '?';

function ficheLines(p: ProjectSummary, lists: ListSettings): string[] {
  return [
    `Projet : ${p.name}${p.code ? ` (${p.code})` : ''}`,
    `Statut : ${statusLabel(lists, 'project', p.status)} · priorité ${p.priority} · météo actuelle : ${HEALTH_LABELS[p.health]}${p.healthComment ? ` (${p.healthComment})` : ''}`,
    p.demandeur && `Demandeur : ${p.demandeur}`,
    p.chefDeProjet && `Chef de projet : ${p.chefDeProjet}`,
    (p.startDate || p.targetDate) && `Dates : début ${d(p.startDate)}, fin visée ${d(p.targetDate)}`,
  ].filter((l): l is string => !!l);
}

/** Résumé court du projet donné avec un compte rendu à analyser (pour éviter les doublons). */
function digestBrief(p: ProjectSummary, items: ProjectItems, lists: ListSettings): string {
  const open = items.tasks.filter((t) => !t.done);
  return [
    ...ficheLines(p, lists),
    `Intervenants : ${items.contacts.map((c) => `${c.name}${c.role ? ` (${c.role}${c.organisation ? `, ${c.organisation}` : ''})` : ''}`).join(' ; ') || '(aucun)'}`,
    `Tâches déjà ouvertes : ${open.map((t) => t.title).join(' ; ') || '(aucune)'}`,
    `Jalons existants : ${items.jalons.map((j) => `${j.label} (${j.startDate ? `${d(j.startDate)} → ` : ''}${d(j.date)})`).join(' ; ') || '(aucun)'}`,
    `Risques déjà identifiés : ${items.risks.filter((r) => r.status !== 'clos').map((r) => r.title).join(' ; ') || '(aucun)'}`,
  ].join('\n');
}

/** Données complètes du projet pour le rapport d'avancement. Seules les notes récentes sont envoyées. */
export function reportInput(p: ProjectDetail, lists: ListSettings, today = todayIso()): string {
  const { items } = p;
  const since = new Date(Date.parse(today) - 30 * 86400000).toISOString().slice(0, 10);
  const recentDone = items.tasks.filter((t) => t.done && t.doneAt.slice(0, 10) >= since);
  const open = items.tasks.filter((t) => !t.done);
  const notes = items.notes.filter((n) => (n.date || n.createdAt.slice(0, 10)) >= since && n.kind !== 'rapport').slice(0, 10);
  const section = (title: string, lines: string[]) => `## ${title}\n${lines.length ? lines.join('\n') : '(aucun)'}`;
  return [
    `Date du jour : ${today}`,
    section('Fiche', ficheLines(p, lists)),
    projectSectionsMarkdown(p.sections),
    section(
      'Planning',
      items.jalons.map((j) => {
        const drift = jalonDrift(j);
        return `- ${j.label} : ${j.startDate ? `du ${d(j.startDate)} au ` : ''}${d(j.date)}${j.done ? ' — atteint' : isJalonLate(j, today) ? ' — EN RETARD' : ''}${drift ? ` (glissement ${drift > 0 ? '+' : ''}${drift} j)` : ''}`;
      }),
    ),
    section('Tâches terminées depuis 30 jours', recentDone.map((t) => `- ${t.title}${t.assignee ? ` (${t.assignee})` : ''}`)),
    section(
      'Tâches ouvertes',
      open.map((t) => `- ${t.title}${t.assignee ? ` — ${t.assignee}` : ''}${t.dueDate ? ` — échéance ${t.dueDate}${isTaskOverdue(t, today) ? ' (EN RETARD)' : ''}` : ''}`),
    ),
    section(
      'Prestations',
      items.prestations.map((x) => `- ${x.prestataire} — ${x.objet} : ${statusLabel(lists, 'prestation', x.status)}${x.chargeJours != null ? `, ${x.chargeJours} j/h` : ''}${x.montantHT != null ? `, ${x.montantHT} € HT` : ''}${x.dateLivraison ? `, livraison ${x.dateLivraison}` : ''}`),
    ),
    section(
      'Risques ouverts',
      items.risks.filter((r) => r.status !== 'clos').map((r) => `- ${r.title} (criticité ${riskScore(r)}/9)${r.mitigation ? ` — parade : ${r.mitigation}` : ''}`),
    ),
    section('Journal des 30 derniers jours', notes.map((n) => noteBlock(n, 1500))),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function noteBlock(n: Note, maxChars: number): string {
  const body = n.content.length > maxChars ? `${n.content.slice(0, maxChars)}…` : n.content;
  return `### ${NOTE_KIND_LABELS[n.kind]} : ${n.title}${n.date ? ` (${n.date})` : ''}\n${body}`;
}

/**
 * Informations du projet fournies à l'assistant pour rédiger un cahier des charges.
 * Les rubriques reprennent celles des notes de réunion pour que la rédaction s'appuie dessus de la même façon.
 */
export function projectContextMarkdown(p: ProjectDetail, opts: { prestationId: string | null; noteIds: string[] }, lists: ListSettings): string {
  const { items } = p;
  const presta = items.prestations.find((x) => x.id === opts.prestationId);
  const notes = items.notes.filter((n) => opts.noteIds.includes(n.id));
  const parts = [
    `## Contexte\n${ficheLines(p, lists).map((l) => `- ${l}`).join('\n')}${p.description.trim() ? `\n\n${p.description.trim()}` : ''}`,
    projectSectionsMarkdown(p.sections),
    presta &&
      `## Demandes et besoins\n**Prestation concernée** : ${presta.prestataire} — ${presta.objet}${presta.chargeJours != null ? ` (${presta.chargeJours} j/h estimés)` : ''}${presta.notes.trim() ? `\n${presta.notes.trim()}` : ''}`,
    items.jalons.length && `## Dates et échéances\n${items.jalons.map((j) => `- ${j.label} : ${j.startDate ? `du ${d(j.startDate)} au ` : ''}${d(j.date)}${j.done ? ' (atteint)' : ''}`).join('\n')}`,
    items.risks.some((r) => r.status !== 'clos') &&
      `## Contraintes et risques\n${items.risks
        .filter((r) => r.status !== 'clos')
        .map((r) => `- ${r.title}${r.description ? ` : ${r.description}` : ''}`)
        .join('\n')}`,
    items.contacts.length && `## Intervenants\n${items.contacts.map((c) => `- ${c.name}${c.role ? ` — ${c.role}` : ''}${c.organisation ? ` (${c.organisation})` : ''}`).join('\n')}`,
    notes.length && `## Notes du projet\n${notes.map((n) => noteBlock(n, 8000)).join('\n\n')}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Appels
// ---------------------------------------------------------------------------

export async function digestMeeting(p: ProjectSummary, items: ProjectItems, text: string, title: string, ctx: Ctx): Promise<Digest> {
  const lists = await getLists();
  return callStructured({
    tier: 'fast',
    operation: 'projet_compte_rendu',
    system: DIGEST_SYSTEM,
    input: `Date du jour : ${todayIso()}\nTitre donné par l'utilisateur : ${title || '(aucun)'}\n\n<projet>\n${digestBrief(p, items, lists)}\n</projet>\n\n<transcription>\n${text}\n</transcription>`,
    schema: digestSchema,
    maxTokens: 8000,
    effort: 'low',
    ctx,
  });
}

export async function progressReport(p: ProjectDetail, ctx: Ctx): Promise<Report> {
  const lists = await getLists();
  return callStructured({
    tier: 'smart',
    operation: 'projet_rapport',
    system: REPORT_SYSTEM,
    input: `<donnees_projet>\n${reportInput(p, lists)}\n</donnees_projet>`,
    schema: reportSchema,
    maxTokens: 6000,
    effort: 'low',
    ctx,
  });
}
