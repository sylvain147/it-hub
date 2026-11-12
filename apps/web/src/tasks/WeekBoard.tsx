import { useState } from 'react';
import { addDays } from '@samm/shared';
import { api } from '../api';
import { toast } from '../components/ui';
import { byPosition, type TaskRow } from './tasks';

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Lundi de la semaine de `iso` (AAAA-MM-JJ). */
export function mondayOf(iso: string): string {
  return addDays(iso, -((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7));
}

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return { name: DAY_NAMES[d.getUTCDay()]!, date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` };
};

/**
 * La to-do de la semaine, une carte par jour (du lundi au vendredi, le week-end s'il y a des tâches) : les tâches
 * de chaque jour, à cocher, et un ajout rapide pour ce jour. ◀ ▶ changent de semaine ; sur la semaine en cours, une
 * carte « En retard » reprend ce qui reste des jours passés.
 */
export function WeekBoard({
  rows,
  today,
  week,
  onWeek,
  onEdit,
  onAdd,
  onChanged,
  showAssignee,
}: {
  rows: TaskRow[];
  today: string;
  /** Lundi de la semaine affichée. */
  week: string;
  onWeek: (monday: string) => void;
  onEdit: (t: TaskRow) => void;
  /** Ajout rapide d'une tâche pour un jour ; absent : pas d'ajout (to-do de l'équipe). */
  onAdd?: (title: string, dueDate: string) => Promise<void>;
  onChanged: () => Promise<void> | void;
  showAssignee?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const sunday = days[6]!;
  const thisWeek = week === mondayOf(today);
  const byDay = (d: string) => rows.filter((t) => t.dueDate === d).sort((a, b) => Number(a.done) - Number(b.done) || byPosition(a, b));
  const shown = days.filter((d, i) => i < 5 || byDay(d).length > 0);
  const late = thisWeek ? rows.filter((t) => !t.done && t.dueDate && t.dueDate < week).sort(byPosition) : [];
  const undated = rows.filter((t) => !t.done && !t.dueDate).sort(byPosition);
  const total = rows.filter((t) => t.dueDate >= week && t.dueDate <= sunday);
  const label = `du ${dayLabel(week).date} au ${dayLabel(sunday).date}`;

  async function toggle(t: TaskRow) {
    setBusy(t.id);
    try {
      await api.updateTodo(t.id, { done: !t.done });
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const list = (tasks: TaskRow[]) =>
    tasks.length === 0 ? (
      <p className="muted small week-empty">Rien de prévu.</p>
    ) : (
      <ul className="week-tasks">
        {tasks.map((t) => (
          <li key={t.id} className={t.done ? 'done' : undefined}>
            <input type="checkbox" checked={t.done} disabled={busy === t.id} onChange={() => void toggle(t)} aria-label={t.done ? 'Rouvrir la tâche' : 'Cocher la tâche'} />
            <button className="week-task-title" onClick={() => onEdit(t)} title="Ouvrir la tâche">
              {t.title}
              {(t.project || (showAssignee && t.assignee) || t.subtasks.length > 0) && (
                <span className="week-task-meta">
                  {[t.project?.name, showAssignee ? t.assignee : '', t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : ''].filter(Boolean).join(' · ')}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    );

  return (
    <div>
      <div className="week-nav">
        <button className="btn btn-sm" onClick={() => onWeek(addDays(week, -7))} aria-label="Semaine précédente">◀</button>
        <strong className="week-label">{thisWeek ? 'Cette semaine' : addDays(week, -7) === mondayOf(today) ? 'Semaine prochaine' : `Semaine ${label}`}</strong>
        <button className="btn btn-sm" onClick={() => onWeek(addDays(week, 7))} aria-label="Semaine suivante">▶</button>
        {!thisWeek && <button className="btn btn-sm btn-ghost" onClick={() => onWeek(mondayOf(today))}>Revenir à cette semaine</button>}
        <span className="muted small">
          {label} · {total.filter((t) => t.done).length}/{total.length} faite{total.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="week-grid">
        {late.length > 0 && (
          <section className="week-day week-late">
            <h3>⚠ En retard</h3>
            {list(late)}
          </section>
        )}
        {shown.map((d) => {
          const { name, date } = dayLabel(d);
          return (
            <section key={d} className={['week-day', d === today && 'week-today', d < today && 'week-past'].filter(Boolean).join(' ')}>
              <h3>
                {name} <span className="muted small">{date}</span>
                {d === today && <span className="badge week-today-badge">Aujourd’hui</span>}
              </h3>
              {list(byDay(d))}
              {onAdd && <DayQuickAdd onAdd={(title) => onAdd(title, d)} />}
            </section>
          );
        })}
        {thisWeek && undated.length > 0 && (
          <section className="week-day week-undated">
            <h3>Sans échéance</h3>
            {list(undated)}
          </section>
        )}
      </div>
    </div>
  );
}

/** Ajout d'une tâche pour un jour donné (Entrée). */
function DayQuickAdd({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!v.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(v.trim());
      setV('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return <input className="input input-sm week-add" value={v} disabled={busy} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="+ Ajouter… (Entrée)" />;
}
