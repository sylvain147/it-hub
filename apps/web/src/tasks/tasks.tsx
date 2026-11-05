import { useState } from 'react';
import { Link } from 'react-router';
import type { OpenTask, PersonalTask, Task } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { formatDate, shortUser, toast } from '../components/ui';
import { DueLabel, ItemModal, MarkdownField, MarkdownView } from '../projects/common';
import { UserSelect, useUsers } from '../users/context';

/**
 * Tâches : listes de choses à faire que l'on coche. Une tâche est rattachée à un projet ou personnelle (hors projet) ;
 * les mêmes composants servent à l'onglet « Tâches » d'un projet et à la page « Tâches ».
 */

/** Tâche, où qu'elle soit enregistrée. `projectId` vide : tâche personnelle. */
export interface TaskRow {
  id: string;
  title: string;
  details: string;
  done: boolean;
  doneAt: string;
  dueDate: string;
  assigneeId: string;
  /** Nom affiché du responsable (utilisateur du hub ou personne extérieure). */
  assignee: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  createdBy: string;
}

export function projectRow(t: Task | OpenTask, projectId: string, projectName: string): TaskRow {
  return { ...t, projectId, projectName };
}

export function personalRow(t: PersonalTask, name: (email: string) => string): TaskRow {
  return { ...t, assignee: name(t.assigneeId), projectId: '', projectName: '' };
}

export async function setTaskDone(t: TaskRow, done: boolean) {
  if (t.projectId) await api.updateItem(t.projectId, 'tasks', t.id, { done });
  else await api.updateTodo(t.id, { done });
}

export async function deleteTask(t: TaskRow) {
  if (t.projectId) await api.deleteItem(t.projectId, 'tasks', t.id);
  else await api.deleteTodo(t.id);
}

/** Tri : échéance la plus proche d'abord, puis ordre de création. */
export const byDue = (a: TaskRow, b: TaskRow) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt);

/** Liste à cocher. Un clic sur l'intitulé déplie les détails. */
export function TaskChecklist({
  rows,
  onChanged,
  onEdit,
  showProject,
  showAssignee = true,
}: {
  rows: TaskRow[];
  onChanged: () => Promise<void> | void;
  onEdit: (t: TaskRow) => void;
  showProject?: boolean;
  showAssignee?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const { email } = useAuth();

  async function toggle(t: TaskRow) {
    setBusy(t.id);
    try {
      await setTaskDone(t, !t.done);
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
          <li key={`${t.projectId}-${t.id}`} className={t.done ? 'check-item done' : 'check-item'}>
            <input type="checkbox" checked={t.done} disabled={busy === t.id} onChange={() => void toggle(t)} aria-label={t.done ? 'Marquer comme à faire' : 'Marquer comme faite'} />
            <div className="check-body">
              <div className="check-line">
                <button className="check-title" onClick={() => (t.details.trim() ? flip(t.id) : onEdit(t))} title={t.details.trim() ? 'Afficher les détails' : 'Modifier'}>
                  {t.title}
                  {t.details.trim() && <span className="check-more">{expanded ? ' ▾' : ' ▸'}</span>}
                </button>
                <span className="check-meta">
                  {showProject && (t.projectId ? <Link to={`/projets/${t.projectId}?onglet=taches`} className="small">📁 {t.projectName}</Link> : <span className="small muted">Personnelle</span>)}
                  {showAssignee && t.assignee && t.assigneeId !== email && (
                    <span className={t.assigneeId ? 'badge' : 'badge badge-ext'} title={t.assigneeId ? t.assigneeId : 'Personne extérieure au hub'}>{t.assignee}</span>
                  )}
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

/**
 * Création ou modification d'une tâche : intitulé, détails (Markdown), échéance, responsable et projet.
 * Changer de projet (ou passer en tâche personnelle) déplace la tâche.
 */
export function TaskModal({
  task,
  defaults,
  onClose,
  onSaved,
}: {
  task: TaskRow | null;
  defaults: { projectId: string; assigneeId: string };
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { me } = useAuth();
  const { name } = useUsers();
  const projects = useLoad(() => api.listProjects(), []);
  const [f, setF] = useState({
    title: task?.title ?? '',
    details: task?.details ?? '',
    dueDate: task?.dueDate ?? '',
    done: task?.done ?? false,
    projectId: task ? task.projectId : defaults.projectId,
    assigneeId: task ? task.assigneeId : defaults.assigneeId,
    assignee: task && !task.assigneeId ? task.assignee : '',
  });
  const [external, setExternal] = useState(!!task && !task.assigneeId);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // Une tâche personnelle revient toujours à un utilisateur du hub ; seul un rôle habilité la confie à un autre.
  const personal = !f.projectId;
  const ext = external && !personal;
  const restrict = personal && !me.permissions.assignOthers ? [me.email, ...(task?.assigneeId ? [task.assigneeId] : [])] : undefined;

  async function save() {
    const who = ext ? { assigneeId: '', assignee: f.assignee.trim() } : { assigneeId: f.assigneeId || me.email, ...(f.projectId ? { assignee: '' } : {}) };
    const fields = { title: f.title, details: f.details, dueDate: f.dueDate, done: f.done, ...who };
    if (!task) {
      if (f.projectId) await api.createItem(f.projectId, 'tasks', fields);
      else await api.createTodo({ ...fields, assigneeId: who.assigneeId });
    } else {
      let where = task.projectId;
      if (f.projectId !== task.projectId) {
        await api.moveTask({ id: task.id, fromProjectId: task.projectId, toProjectId: f.projectId });
        where = f.projectId;
      }
      if (where) await api.updateItem(where, 'tasks', task.id, fields);
      else await api.updateTodo(task.id, { ...fields, assigneeId: who.assigneeId });
    }
    await onSaved();
  }

  async function remove() {
    if (!task || !confirm(`Supprimer « ${task.title} » ?`)) return;
    try {
      await deleteTask(task);
      toast('Tâche supprimée.');
      onClose();
      await onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const activeProjects = (projects.data ?? []).filter((p) => p.id === f.projectId || !['termine', 'abandonne'].includes(p.status));

  return (
    <ItemModal
      title={task ? 'Tâche' : 'Nouvelle tâche'}
      onClose={onClose}
      onSave={save}
      wide
      canSave={!!f.title.trim() && (ext ? !!f.assignee.trim() : true)}
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
        <span>Projet</span>
        <select className="input" value={f.projectId} onChange={(e) => set('projectId', e.target.value)}>
          <option value="">Aucun — tâche personnelle</option>
          {f.projectId && !activeProjects.some((p) => p.id === f.projectId) && <option value={f.projectId}>{task?.projectName || 'Projet'}</option>}
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Échéance</span>
        <input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
      </label>
      <label className="field">
        <span>Responsable</span>
        {ext ? (
          <input className="input" value={f.assignee} onChange={(e) => set('assignee', e.target.value)} placeholder="Nom ou société (prestataire, métier…)" />
        ) : (
          <UserSelect value={f.assigneeId || me.email} onChange={(v) => set('assigneeId', v)} only={restrict} />
        )}
        {!personal && (
          <button type="button" className="btn-link small" onClick={() => setExternal(!external)}>
            {ext ? 'Choisir un utilisateur du hub' : 'Personne extérieure au hub…'}
          </button>
        )}
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
      {task && f.projectId !== task.projectId && (
        <p className="muted small span-2">
          La tâche sera {f.projectId ? (task.projectId ? 'déplacée vers ce projet' : 'rattachée à ce projet') : 'retirée du projet et deviendra personnelle'}.
        </p>
      )}
    </ItemModal>
  );
}
