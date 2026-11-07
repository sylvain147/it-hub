import { useState } from 'react';
import { Link } from 'react-router';
import { ticketKey, type PersonalTask, type TicketView } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatDate, shortUser, toast } from '../components/ui';
import { DueLabel, ItemModal, MarkdownField, MarkdownView } from '../projects/common';
import { UserSelect, useUsers } from '../users/context';
import { TicketStatusChip } from '../sprints/tickets';

/**
 * To-do : la liste personnelle de choses à faire, que l'on coche. Une tâche peut être liée à un ticket
 * (« relancer le prestataire sur T-12 ») ; le ticket, lui, suit son statut dans le sprint.
 */

/** Tâche de la to-do, avec le nom de son responsable et son ticket lié. */
export interface TaskRow extends PersonalTask {
  assignee: string;
  ticket: TicketView | null;
}

export function todoRow(t: PersonalTask, name: (email: string) => string, tickets: TicketView[]): TaskRow {
  return { ...t, assignee: name(t.assigneeId), ticket: t.ticketId ? (tickets.find((x) => x.id === t.ticketId) ?? null) : null };
}

/** Tri : échéance la plus proche d'abord, puis ordre de création. */
export const byDue = (a: TaskRow, b: TaskRow) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt);

/** Liste à cocher. Un clic sur l'intitulé déplie les détails. */
export function TaskChecklist({
  rows,
  onChanged,
  onEdit,
  showAssignee = true,
}: {
  rows: TaskRow[];
  onChanged: () => Promise<void> | void;
  onEdit: (t: TaskRow) => void;
  showAssignee?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const { email } = useAuth();

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

  const flip = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <ul className="checklist">
      {rows.map((t) => {
        const expanded = open.has(t.id);
        return (
          <li key={t.id} className={t.done ? 'check-item done' : 'check-item'}>
            <input type="checkbox" checked={t.done} disabled={busy === t.id} onChange={() => void toggle(t)} aria-label={t.done ? 'Marquer comme à faire' : 'Marquer comme faite'} />
            <div className="check-body">
              <div className="check-line">
                <button className="check-title" onClick={() => (t.details.trim() ? flip(t.id) : onEdit(t))} title={t.details.trim() ? 'Afficher les détails' : 'Modifier'}>
                  {t.title}
                  {t.details.trim() && <span className="check-more">{expanded ? ' ▾' : ' ▸'}</span>}
                </button>
                <span className="check-meta">
                  {t.ticket && (
                    <Link to={`/projets/${t.ticket.projectId}?onglet=tickets`} className="small" title={`${t.ticket.projectName} — ${t.ticket.title}`}>
                      🎫 {ticketKey(t.ticket)}
                    </Link>
                  )}
                  {showAssignee && t.assignee && t.assigneeId !== email && <span className="badge" title={t.assigneeId}>{t.assignee}</span>}
                  {t.dueDate && <span className="small"><DueLabel date={t.dueDate} done={t.done} /></span>}
                  <button className="btn-icon" title="Modifier" onClick={() => onEdit(t)}>✎</button>
                </span>
              </div>
              {expanded && <MarkdownView markdown={t.details} className="check-details" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Saisie rapide : intitulé puis Entrée. */
export function QuickAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (title: string) => Promise<void> }) {
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
  return (
    <>
      <input className="input quick-add" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder={placeholder} />
      <button className="btn" disabled={!v.trim() || busy} onClick={() => void add()}>Ajouter</button>
    </>
  );
}

/** Création ou modification d'une tâche de la to-do : intitulé, détails (Markdown), échéance, responsable et ticket lié. */
export function TaskModal({
  task,
  defaults,
  tickets,
  onClose,
  onSaved,
}: {
  task: TaskRow | null;
  defaults: { assigneeId: string };
  /** Tickets proposés pour le lien (ouverts). */
  tickets: TicketView[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { me } = useAuth();
  const { name } = useUsers();
  const [f, setF] = useState({
    title: task?.title ?? '',
    details: task?.details ?? '',
    dueDate: task?.dueDate ?? '',
    done: task?.done ?? false,
    assigneeId: task ? task.assigneeId : defaults.assigneeId,
    ticketId: task?.ticketId ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // Seul un rôle habilité confie une tâche à un autre.
  const restrict = !me.permissions.assignOthers ? [me.email, ...(task?.assigneeId ? [task.assigneeId] : [])] : undefined;
  const choices = [...tickets.filter((t) => !t.done), ...(task?.ticket && task.ticket.done ? [task.ticket] : [])].sort((a, b) => a.number - b.number);
  const linked = choices.find((t) => t.id === f.ticketId);

  async function save() {
    const fields = { ...f, assigneeId: f.assigneeId || me.email };
    if (task) await api.updateTodo(task.id, fields);
    else await api.createTodo(fields);
    await onSaved();
  }

  async function remove() {
    if (!task || !confirm(`Supprimer « ${task.title} » ?`)) return;
    try {
      await api.deleteTodo(task.id);
      toast('Tâche supprimée.');
      onClose();
      await onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <ItemModal
      title={task ? 'Tâche' : 'Nouvelle tâche'}
      onClose={onClose}
      onSave={save}
      wide
      canSave={!!f.title.trim()}
      extraFooter={
        task && (
          <>
            <button className="btn btn-danger-ghost" onClick={() => void remove()}>Supprimer</button>
            <span className="muted small">
              Créée le {formatDate(task.createdAt.slice(0, 10))} par {name(task.createdBy) === task.createdBy ? shortUser(task.createdBy) : name(task.createdBy)}
              {task.done && task.doneAt && ` · faite le ${formatDate(task.doneAt.slice(0, 10))}`}
            </span>
          </>
        )
      }
    >
      <label className="field span-2">
        <span>Intitulé *</span>
        <input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className="field">
        <span>Ticket lié</span>
        <select className="input" value={f.ticketId} onChange={(e) => set('ticketId', e.target.value)}>
          <option value="">Aucun</option>
          {f.ticketId && !linked && <option value={f.ticketId}>Ticket supprimé</option>}
          {choices.map((t) => (
            <option key={t.id} value={t.id}>{ticketKey(t)} {t.title} — {t.projectName}</option>
          ))}
        </select>
        {linked && <span className="small"><TicketStatusChip status={linked.status} /></span>}
      </label>
      <label className="field">
        <span>Échéance</span>
        <input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
      </label>
      <label className="field">
        <span>Responsable</span>
        <UserSelect value={f.assigneeId || me.email} onChange={(v) => set('assigneeId', v)} only={restrict} />
      </label>
      <label className="field check-field">
        <span>&nbsp;</span>
        <label className="check">
          <input type="checkbox" checked={f.done} onChange={(e) => set('done', e.target.checked)} /> Faite
        </label>
      </label>
      <div className="field span-2">
        <span>Détails</span>
        <MarkdownField value={f.details} onChange={(v) => set('details', v)} placeholder="Précisions, liens, étapes…" resetKey={task?.id ?? 'nouvelle'} />
      </div>
    </ItemModal>
  );
}
