/** Exécution des tâches IA du module « Projets » (appelée par le runner commun). */
import { todayIso, type JobType, type NoteSuggestions, type Task, type TicketUpdateSuggestion } from '@samm/shared';
import { HttpError, newId } from '../lib/util.js';
import { blobs } from '../storage/blobs.js';
import * as pr from './repo.js';
import { digestMeeting, progressReport, type Digest } from './ai.js';

type Step = (s: string) => Promise<void>;
type Ctx = { user: string; cdcId: string };

const isDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');

/**
 * Mises à jour de tickets proposées par l'IA, ramenées à ce que le hub accepte : ticket ouvert existant (par sa clé),
 * valeurs valides et réellement différentes ; sinon la proposition est écartée.
 */
export function ticketUpdatesOf(raw: Digest['ticketUpdates'], tasks: Task[]): TicketUpdateSuggestion[] {
  const seen = new Set<string>();
  return raw.flatMap((u) => {
    const number = Number(/(\d+)/.exec(u.ticket)?.[1] ?? 0);
    const t = tasks.find((x) => x.number === number && !x.done);
    if (!t || seen.has(t.id)) return [];
    const status = u.status && u.status !== t.status ? u.status : null;
    const dueDate = isDate(u.dueDate) && u.dueDate !== t.dueDate ? u.dueDate : null;
    const priority = u.priority && u.priority !== t.priority ? u.priority : null;
    if (!status && !dueDate && !priority) return [];
    seen.add(t.id);
    return [{ ticketId: t.id, number: t.number, title: t.title, status, dueDate, priority, before: { status: t.status, dueDate: t.dueDate, priority: t.priority }, reason: u.reason.trim().slice(0, 300), state: 'proposee' as const }];
  });
}

export async function runProjectJob(type: JobType, projectId: string, payload: Record<string, unknown>, ctx: Ctx, step: Step): Promise<string> {
  const detail = await pr.getProjectDetail(projectId, []);
  if (type === 'project_digest') {
    const buf = await blobs().get(String(payload.textKey));
    if (!buf) throw new HttpError(404, 'Texte du compte rendu introuvable. Relancez l’opération.');
    const text = buf.toString('utf8');
    const title = String(payload.title ?? '');

    await step('Analyse du compte rendu');
    const out = await digestMeeting(detail, detail.items, text, title, ctx);

    await step('Enregistrement');
    const decisions = out.decisions.filter((x) => x.trim());
    const content = [out.summary.trim(), decisions.length ? `## Décisions\n${decisions.map((x) => `- ${x}`).join('\n')}` : ''].filter(Boolean).join('\n\n');
    const suggestions: NoteSuggestions = {
      plan: out.plan.trim().slice(0, 2000),
      ticketUpdates: ticketUpdatesOf(out.ticketUpdates, detail.items.tasks),
      tasks: out.tasks.filter((t) => t.title.trim()).map((t) => ({ ...t, dueDate: isDate(t.dueDate), state: 'proposee' })),
      jalons: out.jalons.filter((j) => j.label.trim()).map((j) => ({ ...j, date: isDate(j.date), state: 'proposee' })),
      risks: out.risks.filter((r) => r.title.trim()).map((r) => ({ ...r, state: 'proposee' })),
    };
    const noteId = newId();
    await blobs().put(pr.projectBlobKeys.noteSource(projectId, noteId), text, 'text/plain; charset=utf-8');
    await pr.createItem(
      projectId,
      'notes',
      { kind: 'compte_rendu', title: (title || out.title || 'Compte rendu de réunion').slice(0, 300), date: isDate(String(payload.date ?? '')) || todayIso(), content: content.slice(0, 60_000) },
      ctx.user,
      { itemId: noteId, extra: { suggestions, hasSource: true, origin: 'ia' } },
    );
    const n = suggestions.tasks.length + (suggestions.ticketUpdates?.length ?? 0) + suggestions.jalons.length + suggestions.risks.length;
    return n ? `Terminé (${n} proposition${n > 1 ? 's' : ''} à valider dans le journal)` : 'Terminé';
  }

  if (type === 'project_report') {
    await step('Rédaction du rapport');
    const out = await progressReport(detail, ctx);
    await step('Enregistrement');
    await pr.createItem(
      projectId,
      'notes',
      { kind: 'rapport', title: out.title.slice(0, 300) || 'Rapport d’avancement', date: todayIso(), content: out.markdown.slice(0, 60_000) },
      ctx.user,
      { extra: { suggestedHealth: out.suggestedHealth, origin: 'ia' } },
    );
    return 'Terminé (rapport ajouté au journal)';
  }
  throw new Error(`Tâche inconnue : ${type}`);
}
