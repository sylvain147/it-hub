import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CLOSED_PROJECT_STATUSES, subtaskProgress, type PersonalTask, type TodoSubtask } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { formatDate, shortUser, toast } from '../components/ui';
import { DueLabel, ItemModal, MarkdownField, MarkdownView } from '../projects/common';
import { UserSelect, useUsers } from '../users/context';
import { NewProjectDialog } from '../projects/NewProjectDialog';

/**
 * To-do : la liste de choses à faire, que l'on coche, rattachées ou non à un projet. Elle est indépendante des
 * tickets : une tâche ne se planifie pas dans un sprint et n'a pas de statut.
 */

/** Projet proposé pour le rattachement (nom affiché). */
export interface ProjectRef {
  id: string;
  name: string;
  /** Projet terminé ou abandonné : plus proposé, mais toujours affiché. */
  closed: boolean;
}

/** Tâche de la to-do, avec le nom de son responsable et son projet. */
export interface TaskRow extends PersonalTask {
  assignee: string;
  project: ProjectRef | null;
}

export function todoRow(t: PersonalTask, name: (email: string) => string, projects: ProjectRef[]): TaskRow {
  return { ...t, assignee: name(t.assigneeId), project: t.projectId ? (projects.find((p) => p.id === t.projectId) ?? null) : null };
}

/** Tri : échéance la plus proche d'abord, puis ordre de création. */
export const byDue = (a: TaskRow, b: TaskRow) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt);

/** Tri de la to-do : l'ordre choisi par glisser-déposer, puis les tâches jamais déplacées, par échéance. */
export const byPosition = (a: TaskRow, b: TaskRow) =>
  (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || byDue(a, b);

/** Déplace `id` à l'index `to` de la liste. */
function moveTo(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((x) => x !== id);
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, id);
  return rest;
}

/** Identifiant d'une nouvelle sous-tâche (unique dans sa tâche). */
export function newSubtaskId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
}

/** Avancement des sous-tâches (« ☑ 2/5 »), complet en vert. */
export function SubtaskProgress({ task }: { task: Pick<PersonalTask, 'subtasks'> }) {
  const p = subtaskProgress(task);
  if (!p) return null;
  return (
    <span className={p.done === p.total ? 'subtask-progress complete' : 'subtask-progress'} title={`${p.done} sous-tâche${p.done > 1 ? 's' : ''} faite${p.done > 1 ? 's' : ''} sur ${p.total}`}>
      ☑ {p.done}/{p.total}
    </span>
  );
}

/**
 * Sous-tâches d'une tâche, à cocher sur place, et saisie rapide d'une nouvelle étape (Entrée : ajoute et reste
 * ouverte pour la suivante ; Échap : ferme).
 */
function SubtaskChecklist({ task, adding, onCloseAdd, onChanged }: { task: TaskRow; adding: boolean; onCloseAdd: () => void; onChanged: () => Promise<void> | void }) {
  // Affichage immédiat, en attendant le rechargement.
  const [local, setLocal] = useState<TodoSubtask[] | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(task.subtasks ?? []);
  useEffect(() => setLocal(null), [key]);
  const list = local ?? task.subtasks ?? [];

  async function save(next: TodoSubtask[]) {
    setLocal(next);
    try {
      await api.updateTodo(task.id, { subtasks: next });
      await onChanged();
    } catch (e) {
      setLocal(null);
      toast((e as Error).message, 'error');
      throw e;
    }
  }

  async function add() {
    const v = title.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await save([...list, { id: newSubtaskId(), title: v, done: false }]);
      setTitle('');
    } catch {
      /* déjà signalé */
    } finally {
      setBusy(false);
    }
  }

  if (!list.length && !adding) return null;
  return (
    <div className="subtasks">
      {list.length > 0 && (
        <ul className="subtask-list">
          {list.map((st) => (
            <li key={st.id} className={st.done ? 'done' : undefined}>
              <label>
                <input type="checkbox" checked={st.done} onChange={() => void save(list.map((x) => (x.id === st.id ? { ...x, done: !x.done } : x))).catch(() => {})} />
                <span>{st.title}</span>
              </label>
              <button className="btn-icon subtask-remove" title="Supprimer la sous-tâche" aria-label={`Supprimer « ${st.title} »`} onClick={() => void save(list.filter((x) => x.id !== st.id)).catch(() => {})}>×</button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <input
          className="input input-sm subtask-add"
          autoFocus
          value={title}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
            if (e.key === 'Escape') onCloseAdd();
          }}
          onBlur={() => !title.trim() && onCloseAdd()}
          placeholder="Nouvelle sous-tâche, puis Entrée (Échap pour finir)"
        />
      )}
    </div>
  );
}

/**
 * Liste à cocher. Un clic sur l'intitulé déplie les détails. Les sous-tâches s'affichent sous la tâche et se cochent
 * sur place ; ＋ en ajoute une. Avec `reorderable`, la poignée ⠿ range les tâches par
 * glisser-déposer (souris ou doigt), ou au clavier avec les flèches.
 */
export function TaskChecklist({
  rows,
  onChanged,
  onEdit,
  showAssignee = true,
  showProject = true,
  reorderable = false,
  focusId,
}: {
  rows: TaskRow[];
  onChanged: () => Promise<void> | void;
  onEdit: (t: TaskRow) => void;
  showAssignee?: boolean;
  showProject?: boolean;
  reorderable?: boolean;
  /** Tâche à mettre en évidence (lien depuis le planning). */
  focusId?: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  // Tâche dont on saisit une sous-tâche.
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const { email } = useAuth();
  const listRef = useRef<HTMLUListElement>(null);
  // Ordre affiché pendant et juste après un déplacement, en attendant le rechargement.
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const rowsKey = rows.map((t) => t.id).join(',');
  useEffect(() => setOrder(null), [rowsKey]);
  const shown = order ? order.map((id) => rows.find((t) => t.id === id)).filter((t): t is TaskRow => !!t) : rows;

  useEffect(() => {
    if (focusId) listRef.current?.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusId, rowsKey]);

  async function commit(ids: string[]) {
    if (ids.join(',') === rowsKey) return setOrder(null);
    setOrder(ids);
    try {
      await api.reorderTodos(ids);
      await onChanged();
    } catch (e) {
      setOrder(null);
      toast((e as Error).message, 'error');
    }
  }

  /** Index d'insertion sous le pointeur : avant la première tâche dont le milieu est plus bas. */
  function indexAt(y: number, id: string): number {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>(':scope > li') ?? [])].filter((li) => li.dataset.id !== id);
    const i = items.findIndex((li) => {
      const r = li.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return i < 0 ? items.length : i;
  }

  // Le pointeur est suivi sur toute la fenêtre : la ligne déplacée change de place dans le DOM pendant le glisser.
  const drag = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
      if (e.button !== 0) return;
      e.preventDefault();
      let current = shown.map((t) => t.id);
      setDragging(id);
      setOrder(current);
      const move = (ev: PointerEvent) => {
        const next = moveTo(current, id, indexAt(ev.clientY, id));
        if (next.join(',') === current.join(',')) return;
        current = next;
        setOrder(next);
      };
      const end = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        setDragging(null);
        void commit(current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    },
    onKeyDown: (e: React.KeyboardEvent, id: string) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const ids = shown.map((t) => t.id);
      const to = ids.indexOf(id) + (e.key === 'ArrowUp' ? -1 : 1);
      if (to >= 0 && to < ids.length) void commit(moveTo(ids, id, to)).then(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .drag-handle`)?.focus());
    },
  };

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
    <ul className={dragging ? 'checklist dragging' : 'checklist'} ref={listRef}>
      {shown.map((t) => {
        const expanded = open.has(t.id);
        return (
          <li key={t.id} data-id={t.id} className={['check-item', t.done && 'done', dragging === t.id && 'drag-source', focusId === t.id && 'focus'].filter(Boolean).join(' ')}>
            {reorderable && shown.length > 1 && (
              <button
                className="drag-handle"
                title="Glisser pour déplacer (ou flèches haut et bas)"
                aria-label={`Déplacer « ${t.title} »`}
                onPointerDown={(e) => drag.onPointerDown(e, t.id)}
                onKeyDown={(e) => drag.onKeyDown(e, t.id)}
              >
                ⠿
              </button>
            )}
            <input type="checkbox" checked={t.done} disabled={busy === t.id} onChange={() => void toggle(t)} aria-label={t.done ? 'Marquer comme à faire' : 'Marquer comme faite'} />
            <div className="check-body">
              <div className="check-line">
                <button className="check-title" onClick={() => (t.details.trim() ? flip(t.id) : onEdit(t))} title={t.details.trim() ? 'Afficher les détails' : 'Modifier'}>
                  {t.title}
                  {t.details.trim() && <span className="check-more">{expanded ? ' ▾' : ' ▸'}</span>}
                </button>
                <span className="check-meta">
                  <SubtaskProgress task={t} />
                  {showProject && t.project && (
                    <Link to={`/projets/${t.project.id}?onglet=todo`} className="small" title="Voir la to-do du projet">
                      📁 {t.project.name}
                    </Link>
                  )}
                  {showAssignee && t.assignee && t.assigneeId !== email && <span className="badge" title={t.assigneeId}>{t.assignee}</span>}
                  {t.dueDate && <span className="small"><DueLabel date={t.dueDate} done={t.done} /></span>}
                  <button className="btn-icon" title="Ajouter une sous-tâche" aria-label={`Ajouter une sous-tâche à « ${t.title} »`} onClick={() => setAddingTo(t.id)}>＋</button>
                  <button className="btn-icon" title="Modifier" onClick={() => onEdit(t)}>✎</button>
                </span>
              </div>
              {expanded && <MarkdownView markdown={t.details} className="check-details" />}
              <SubtaskChecklist task={t} adding={addingTo === t.id} onCloseAdd={() => setAddingTo((x) => (x === t.id ? null : x))} onChanged={onChanged} />
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

/** Création ou modification d'une tâche de la to-do : intitulé, détails (Markdown), échéance, responsable et projet. */
export function TaskModal({
  task,
  defaults,
  projects,
  onClose,
  onSaved,
}: {
  task: TaskRow | null;
  defaults: { assigneeId: string; projectId?: string };
  /** Projets proposés pour le rattachement. */
  projects: ProjectRef[];
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
    projectId: task ? task.projectId : (defaults.projectId ?? ''),
    subtasks: task?.subtasks ?? [],
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // Projet pas encore créé : il se crée depuis la tâche, qui y est aussitôt rattachée.
  const [newProject, setNewProject] = useState(false);
  const [created, setCreated] = useState<ProjectRef[]>([]);
  const projectChoices = useMemo(() => [...projects, ...created.filter((c) => !projects.some((p) => p.id === c.id))], [projects, created]);
  // Seul un rôle habilité confie une tâche à un autre.
  const restrict = !me.permissions.assignOthers ? [me.email, ...(task?.assigneeId ? [task.assigneeId] : [])] : undefined;

  async function save() {
    // Une sous-tâche vidée est retirée.
    const fields = { ...f, assigneeId: f.assigneeId || me.email, subtasks: f.subtasks.map((x) => ({ ...x, title: x.title.trim() })).filter((x) => x.title) };
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
        <span>Projet</span>
        <div className="project-pick">
          <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} projects={projectChoices} emptyLabel="Aucun (tâche personnelle)" />
          <button type="button" className="btn" onClick={() => setNewProject(true)} title="Créer un projet et y rattacher la tâche">+ Nouveau projet</button>
        </div>
        {f.projectId && <span className="muted small">Visible de toute l’équipe dans la to-do du projet.</span>}
      </label>
      {newProject && (
        <NewProjectDialog
          onClose={() => setNewProject(false)}
          onCreated={(p) => {
            setCreated((c) => [...c, { id: p.id, name: p.name, closed: false }]);
            set('projectId', p.id);
            setNewProject(false);
            toast(`Projet « ${p.name} » créé.`);
          }}
        />
      )}
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
        <span>Sous-tâches</span>
        <SubtaskEditor value={f.subtasks} onChange={(v) => set('subtasks', v)} />
      </div>
      <div className="field span-2">
        <span>Détails</span>
        <MarkdownField value={f.details} onChange={(v) => set('details', v)} placeholder="Précisions, liens…" resetKey={task?.id ?? 'nouvelle'} />
      </div>
    </ItemModal>
  );
}

/** Sous-tâches dans la fiche d'une tâche : cocher, renommer, ranger (↑ ↓), supprimer, ajouter. */
function SubtaskEditor({ value, onChange }: { value: TodoSubtask[]; onChange: (v: TodoSubtask[]) => void }) {
  const [title, setTitle] = useState('');
  const patch = (id: string, p: Partial<TodoSubtask>) => onChange(value.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  const add = () => {
    if (!title.trim()) return;
    onChange([...value, { id: newSubtaskId(), title: title.trim(), done: false }]);
    setTitle('');
  };
  return (
    <div className="subtask-editor">
      {value.map((st, i) => (
        <div key={st.id} className={st.done ? 'subtask-row done' : 'subtask-row'}>
          <input type="checkbox" checked={st.done} onChange={(e) => patch(st.id, { done: e.target.checked })} aria-label={st.done ? 'Marquer comme à faire' : 'Marquer comme faite'} />
          <input className="input input-sm" value={st.title} maxLength={300} onChange={(e) => patch(st.id, { title: e.target.value })} aria-label={`Sous-tâche ${i + 1}`} />
          <button type="button" className="btn-icon" title="Monter" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="btn-icon" title="Descendre" disabled={i === value.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="btn-icon" title="Supprimer" onClick={() => onChange(value.filter((x) => x.id !== st.id))}>×</button>
        </div>
      ))}
      <div className="subtask-row">
        <span className="subtask-plus">＋</span>
        <input
          className="input input-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder={value.length ? 'Étape suivante, puis Entrée' : 'Découper la tâche en étapes : première étape, puis Entrée'}
          maxLength={300}
        />
      </div>
    </div>
  );
}

/** Projets, par nom, pour le rattachement d'une tâche ou d'une note. */
export function useProjectRefs(): ProjectRef[] {
  const { data } = useLoad(() => api.listProjects(), []);
  return useMemo(
    () => (data ?? []).map((p) => ({ id: p.id, name: p.name, closed: CLOSED_PROJECT_STATUSES.includes(p.status) })).sort((a, b) => a.name.localeCompare(b.name, 'fr')),
    [data],
  );
}

/** Choix du projet : les projets ouverts, et le projet actuel s'il est clos. */
export function ProjectSelect({ value, onChange, projects, emptyLabel }: { value: string; onChange: (id: string) => void; projects: ProjectRef[]; emptyLabel: string }) {
  const shown = projects.filter((p) => !p.closed || p.id === value);
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel}</option>
      {value && projects.length > 0 && !shown.some((p) => p.id === value) && <option value={value}>Projet supprimé</option>}
      {shown.map((p) => (
        <option key={p.id} value={p.id}>{p.name}{p.closed ? ' (clos)' : ''}</option>
      ))}
    </select>
  );
}
