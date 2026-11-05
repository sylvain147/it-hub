/**
 * Tâches IA du suivi TMA.
 *
 * Économie :
 *  - classement par thème : modèle rapide, par lots, uniquement les tickets pas encore classés (sauf demande
 *    explicite) ; chaque ticket n'est envoyé qu'une fois ;
 *  - synthèse : le modèle de rédaction ne reçoit que les chiffres déjà calculés (quelques Ko), jamais les
 *    lignes brutes ni les descriptions.
 */
import { buildMonthReport, monthLabel, NO_THEME, previousMonth, type JobType, type StoredTicket, type TmaMonthReport } from '@samm/shared';
import { callStructured } from '../ai/llm.js';
import { HttpError, nowIso } from '../lib/util.js';
import * as tma from './repo.js';
import { SYNTHESIS_SYSTEM, THEMES_SYSTEM } from './prompts.js';
import { synthesisSchema, themesSchema } from './ai-schemas.js';

type Ctx = { user: string; cdcId: string };
type Step = (s: string) => Promise<void>;

/** Tickets par appel au modèle. */
const THEME_BATCH = 40;
/** Longueur de description envoyée au modèle (le début suffit à qualifier le problème). */
const DESCRIPTION_CHARS = 1200;
const THEME_MAX_CHARS = 80;

export async function runTmaJob(type: JobType, targetId: string, payload: Record<string, unknown>, ctx: Ctx, step: Step): Promise<string> {
  if (type === 'tma_classify') return classify(payload.all === true, ctx, step);
  return synthesize(targetId, ctx, step);
}

function ticketBlock(t: StoredTicket): string {
  const facts = [
    t.category && `Catégorie : ${t.category}`,
    t.cause && `Cause : ${t.cause}`,
    t.product && `Produit : ${t.product}`,
    t.entity && `Entité : ${t.entity}`,
  ].filter(Boolean);
  const desc = t.description.replace(/\s+/g, ' ').trim();
  return `### #${t.id} — ${t.subject.trim() || '(sans sujet)'}\n${facts.join(' · ')}\n${desc.length > DESCRIPTION_CHARS ? desc.slice(0, DESCRIPTION_CHARS) + '…' : desc}`;
}

async function classify(all: boolean, ctx: Ctx, step: Step): Promise<string> {
  const tickets = await tma.listTickets();
  const todo = tickets.filter((t) => all || !t.theme).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!todo.length) throw new HttpError(400, 'Tous les tickets sont déjà classés.');
  // Les thèmes déjà utilisés sont proposés au modèle pour rester cohérent d'un import à l'autre.
  const themes = new Set(all ? [] : tickets.map((t) => t.theme).filter(Boolean));
  let done = 0;
  for (let i = 0; i < todo.length; i += THEME_BATCH) {
    const batch = todo.slice(i, i + THEME_BATCH);
    await step(`Classement des tickets (${i + batch.length} / ${todo.length})`);
    const out = await callStructured({
      tier: 'fast',
      operation: 'tma_themes',
      system: THEMES_SYSTEM,
      input: `<themes_existants>\n${themes.size ? [...themes].sort().map((t) => `- ${t}`).join('\n') : '(aucun)'}\n</themes_existants>\n\n<tickets>\n${batch.map(ticketBlock).join('\n\n')}\n</tickets>`,
      schema: themesSchema,
      maxTokens: 4000,
      effort: 'low',
      ctx,
    });
    const ids = new Set(batch.map((t) => t.id));
    const result = new Map<string, string>();
    for (const it of out.items) {
      const id = it.id.replace(/^#/, '').trim();
      const theme = it.theme.replace(/\s+/g, ' ').trim().slice(0, THEME_MAX_CHARS);
      if (ids.has(id) && theme && theme !== NO_THEME) result.set(id, theme);
    }
    for (const t of result.values()) themes.add(t);
    await tma.setThemes(result);
    done += result.size;
  }
  const missing = todo.length - done;
  return `${done} ticket(s) classé(s) en ${themes.size} thème(s)${missing ? ` ; ${missing} sans réponse (relancez le classement)` : ''}`;
}

const h = (n: number) => `${(Math.round(n * 2) / 2).toLocaleString('fr-FR')} h`;

/** Chiffres du mois en Markdown compact, seule entrée du modèle de rédaction. */
export function reportToMarkdown(r: TmaMonthReport): string {
  const lines: string[] = [];
  const list = (title: string, rows: { key: string; hours: number; count: number }[], unit: 'h' | 'n', max = 12) => {
    if (!rows.length) return;
    lines.push(`\n### ${title}`);
    for (const x of rows.slice(0, max)) lines.push(`- ${x.key} : ${unit === 'h' ? `${h(x.hours)} (${x.count} ticket(s))` : x.count}`);
    if (rows.length > max) lines.push(`- … ${rows.length - max} autre(s)`);
  };
  lines.push(`# Suivi TMA — ${monthLabel(r.month)}`);
  lines.push(`- Temps total : ${h(r.totalHours)} (${r.totalDays.toLocaleString('fr-FR')} j) sur ${r.entryCount} ligne(s) de relevé`);
  lines.push(`- Sur des tickets : ${h(r.ticketHours)} ; pilotage et réunions : ${h(r.pilotageHours)} ; autres activités hors ticket : ${h(r.otherHours)}`);
  lines.push(`- Tickets Desk créés dans le mois : ${r.createdTickets}`);
  if (r.previous) {
    const p = r.previous;
    lines.push(`- Mois précédent (${monthLabel(p.month)}) : ${h(p.totalHours)} au total, ${h(p.ticketHours)} sur tickets, ${h(p.pilotageHours)} de pilotage, ${p.createdTickets} ticket(s) créé(s)`);
  } else lines.push('- Mois précédent : relevé non importé');
  lines.push('\n### Temps par intervenant');
  for (const p of r.byPerson) lines.push(`- ${p.key} : ${h(p.hours)} dont ${h(p.ticketHours)} sur tickets`);
  lines.push('\n### Tickets les plus consommateurs');
  for (const t of r.byTicket.slice(0, 15)) {
    const info = t.ticket ? `${t.ticket.subject} — ${t.ticket.category || '?'} · ${t.ticket.status || '?'} · thème : ${t.ticket.theme || NO_THEME}` : 'inconnu des exports Desk (évolution ou ticket ancien)';
    lines.push(`- #${t.id} : ${h(t.hours)} — ${info}`);
  }
  if (r.byTicket.length > 15) lines.push(`- … ${r.byTicket.length - 15} autre(s) ticket(s) avec du temps`);
  list('Temps par catégorie Desk', r.timeByCategory, 'h');
  list('Temps par thème', r.timeByTheme, 'h');
  list('Tickets créés par catégorie', r.created.byCategory, 'n');
  list('Tickets créés par cause', r.created.byCause, 'n');
  list('Tickets créés par thème', r.created.byTheme, 'n', 15);
  list('Tickets créés par priorité', r.created.byPriority, 'n');
  if (r.unclassified) lines.push(`\n(${r.unclassified} ticket(s) créé(s) dans le mois ne sont pas encore classés par thème.)`);
  if (r.unknownTickets.length) lines.push(`\n### Tickets cités dans le relevé mais absents des exports Desk\n${r.unknownTickets.map((id) => `#${id}`).join(', ')}`);
  if (r.unattached.length) {
    lines.push('\n### Principales activités hors ticket');
    for (const u of r.unattached.slice(0, 12)) lines.push(`- ${u.person}, ${h(u.hours)} (${u.activity === 'pilotage' ? 'pilotage' : 'autre'}) : ${u.comment.slice(0, 160)}`);
  }
  return lines.join('\n');
}

async function synthesize(month: string, ctx: Ctx, step: Step): Promise<string> {
  await step('Calcul des chiffres du mois');
  const [{ entries }, tickets, prevEntries] = await Promise.all([tma.getMonth(month), tma.listTickets(), tma.getMonthEntries(previousMonth(month))]);
  const report = buildMonthReport(month, entries, tickets, prevEntries ? { month: previousMonth(month), entries: prevEntries } : null);
  await step('Rédaction de la synthèse');
  const out = await callStructured({
    tier: 'smart',
    operation: 'tma_synthese',
    system: SYNTHESIS_SYSTEM,
    input: `<chiffres_du_mois>\n${reportToMarkdown(report)}\n</chiffres_du_mois>`,
    schema: synthesisSchema,
    maxTokens: 4000,
    effort: 'medium',
    ctx,
  });
  await step('Enregistrement');
  await tma.setSynthesis(month, { markdown: out.markdown.trim(), createdAt: nowIso(), createdBy: ctx.user });
  return 'Synthèse rédigée';
}
