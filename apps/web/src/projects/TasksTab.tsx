import { useMemo, useState } from 'react';
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, isTaskOverdue, type Priority, type Task, type TaskStatus } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState, formatDate, shortUser, toast } from '../components/ui';
import { DataList, DueLabel, ItemModal, PriorityTag, isMine, knownPeople, useItemActions, useProject } from './common';

type View = 'tableau' | 'liste';

export function TasksTab() {
  const { project, reload } = useProject();
  const { email } = useAuth();
  const actions = useItemActions();
  const [view, setView] = useState<View>('tableau');
  const [who, setWho] = useState('');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState('');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const people = [...new Set(project.items.tasks.map((t) => t.assignee.trim()).filter(Boolean))].sort();
  const tasks = useMemo(
    () =>
      project.items.tasks.filter((t) => {
        if (who === '__me' && !isMine(t.assignee, email)) return false;
        if (who === '__none' && t.assignee.trim()) return false;
        if (who && !who.startsWith('__') && t.assignee.trim() !== who) return false;
        return !q.trim() || `${t.title} ${t.details}`.toLowerCase().includes(q.trim().toLowerCase());
      }),
    [project.items.tasks, who, q, email],
  );

  async function quickAdd() {
    if (!quick.trim()) return;
    try {
      await api.createItem(project.id, 'tasks', { title: quick.trim(), assignee: who && !who.startsWith('__') ? who : who === '__me' ? shortUser(email) : '' });
      setQuick('');
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function move(t: Task, status: TaskStatus) {
    if (t.status === status) return;
    try {
      await api.updateItem(project.id, 'tasks', t.id, { status });
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div>
      <div className="toolbar-row">
        <input
          className="input quick-add"
          placeholder="+ Nouvelle tâche : tapez l’intitulé puis Entrée"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
        />
        <button className="btn" onClick={() => setEditing('new')}>Tâche détaillée…</button>
        <span className="tb-flex" />
        <input className="input input-auto" placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input input-auto" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Tous les responsables</option>
          <option value="__me">Mes tâches</option>
          <option value="__none">Sans responsable</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <div className="seg">
          <button className={view === 'tableau' ? 'on' : ''} onClick={() => setView('tableau')}>Tableau</button>
          <button className={view === 'liste' ? 'on' : ''} onClick={() => setView('liste')}>Liste</button>
        </div>
      </div>

      {project.items.tasks.length === 0 ? (
        <EmptyState>Aucune tâche. Ajoutez-en ci-dessus, ou faites-les proposer par l’assistant à partir d’un compte rendu de réunion (onglet Journal).</EmptyState>
      ) : view === 'tableau' ? (
        <div className="board">
          {TASK_STATUSES.map((st) => {
            const col = tasks.filter((t) => t.status === st);
            const visible = st === 'fait' && !showDone ? col.slice(-5).reverse() : col;
            return (
              <div
                key={st}
                className={`board-col col-${st}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  const t = project.items.tasks.find((x) => x.id === dragId);
                  setDragId(null);
                  if (t) void move(t, st);
                }}
              >
                <div className="board-col-head">
                  {TASK_STATUS_LABELS[st]} <span className="pill pill-muted">{col.length}</span>
                </div>
                {visible.map((t) => (
                  <div
                    key={t.id}
                    className={`task-card${isTaskOverdue(t) ? ' task-late' : ''}${dragId === t.id ? ' dragging' : ''}`}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => setEditing(t)}
                  >
                    <div className="task-title">{t.title}</div>
                    <div className="task-meta">
                      {t.assignee && <span className="badge">{t.assignee}</span>}
                      {t.dueDate && <DueLabel date={t.dueDate} done={t.status === 'fait'} />}
                      <PriorityTag priority={t.priority} hideNormal />
                    </div>
                  </div>
                ))}
                {st === 'fait' && col.length > 5 && (
                  <button className="btn-link small" onClick={() => setShowDone(!showDone)}>{showDone ? 'Réduire' : `Voir les ${col.length} tâches terminées`}</button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Tâche</th>
                <th>Responsable</th>
                <th>Échéance</th>
                <th>Priorité</th>
                <th>Statut</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className={t.status === 'fait' ? 'row-done' : ''}>
                  <td>
                    <input type="checkbox" checked={t.status === 'fait'} title="Terminée" onChange={(e) => void move(t, e.target.checked ? 'fait' : 'a_faire')} />
                  </td>
                  <td>
                    <button className="btn-link strong-link" onClick={() => setEditing(t)}>{t.title}</button>
                    {t.details && <div className="muted small clamp">{t.details}</div>}
                  </td>
                  <td>{t.assignee || <span className="muted">—</span>}</td>
                  <td><DueLabel date={t.dueDate} done={t.status === 'fait'} /></td>
                  <td><PriorityTag priority={t.priority} /></td>
                  <td>
                    <select className="input input-sm" value={t.status} onChange={(e) => void move(t, e.target.value as TaskStatus)}>
                      {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                    </select>
                  </td>
                  <td><button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('tasks', t.id, t.title)}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TaskDialog task={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TaskDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const { project } = useProject();
  const { email } = useAuth();
  const actions = useItemActions();
  const [f, setF] = useState({
    title: task?.title ?? '',
    details: task?.details ?? '',
    status: task?.status ?? ('a_faire' as TaskStatus),
    priority: task?.priority ?? ('normale' as Priority),
    assignee: task?.assignee ?? '',
    dueDate: task?.dueDate ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <ItemModal
      title={task ? 'Tâche' : 'Nouvelle tâche'}
      onClose={onClose}
      canSave={!!f.title.trim()}
      onSave={() => actions.save('tasks', task?.id ?? null, f)}
      extraFooter={
        task && (
          <>
            <button className="btn btn-danger-ghost" onClick={() => void actions.remove('tasks', task.id, task.title).then((ok) => ok && onClose())}>Supprimer</button>
            <span className="muted small">Créée le {formatDate(task.createdAt.slice(0, 10))} par {shortUser(task.createdBy)}{task.doneAt && ` · terminée le ${formatDate(task.doneAt.slice(0, 10))}`}</span>
          </>
        )
      }
    >
      <label className="field span-2">
        <span>Intitulé *</span>
        <input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className="field">
        <span>Responsable</span>
        <input className="input" list="people" value={f.assignee} onChange={(e) => set('assignee', e.target.value)} />
        <DataList id="people" values={knownPeople(project, email)} />
      </label>
      <label className="field">
        <span>Échéance</span>
        <input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
      </label>
      <label className="field">
        <span>Statut</span>
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Priorité</span>
        <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
          {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="field span-2">
        <span>Détails</span>
        <textarea className="input" rows={4} value={f.details} onChange={(e) => set('details', e.target.value)} />
      </label>
    </ItemModal>
  );
}
