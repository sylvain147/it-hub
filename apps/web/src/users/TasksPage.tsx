import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PRIORITIES, PRIORITY_LABELS, TASK_STATUSES, type OpenTask, type PersonalTask, type Priority, type TaskStatus, type TodoInput } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, toast } from '../components/ui';
import { DueLabel, PriorityTag } from '../projects/common';
import { useSettings } from '../settings/context';
import { UserSelect, useUsers } from './context';

type Row = { kind: 'perso'; task: PersonalTask } | { kind: 'projet'; task: OpenTask };

const dueKey = (r: Row) => r.task.dueDate || '9999-12-31';

/** Tâches d'une personne (ou de l'équipe) : tâches de projet ouvertes et tâches personnelles. */
export function TasksPage() {
  const { me } = useAuth();
  const { name } = useUsers();
  const { label } = useSettings();
  const [params, setParams] = useSearchParams();
  const scope = me.permissions.seeAllTodos ? (params.get('qui') ?? me.email) : me.email;
  const data = useLoad(() => api.todos(scope), [scope]);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<PersonalTask | 'new' | null>(null);
  const [quick, setQuick] = useState('');
  const team = scope === 'all';

  async function addQuick() {
    if (!quick.trim()) return;
    try {
      await api.createTodo({ title: quick.trim(), assigneeId: team ? me.email : scope });
      setQuick('');
      await data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function setStatus(r: Row, status: TaskStatus) {
    try {
      if (r.kind === 'perso') await api.updateTodo(r.task.id, { status });
      else await api.updateItem(r.task.projectId, 'tasks', r.task.id, { status });
      if (status === 'fait') toast(`« ${r.task.title} » terminée.`);
      await data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const rows: Row[] = data.data
    ? [...data.data.personal.map((task) => ({ kind: 'perso' as const, task })), ...data.data.project.map((task) => ({ kind: 'projet' as const, task }))]
    : [];
  const open = rows.filter((r) => r.task.status !== 'fait').sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || a.task.title.localeCompare(b.task.title, 'fr'));
  const done = rows.filter((r) => r.task.status === 'fait').sort((a, b) => b.task.doneAt.localeCompare(a.task.doneAt));
  const today = new Date().toISOString().slice(0, 10);
  const late = open.filter((r) => r.task.dueDate && r.task.dueDate < today).length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tâches</h1>
          <p className="muted small">
            {team ? 'Toute l’équipe' : scope === me.email ? 'Mes tâches' : `Tâches de ${name(scope)}`} : tâches des projets et tâches personnelles (hors projet).
          </p>
        </div>
        <div className="actions">
          {me.permissions.seeAllTodos && (
            <select className="input input-auto" value={scope} onChange={(e) => setParams(e.target.value === me.email ? {} : { qui: e.target.value }, { replace: true })} aria-label="Tâches de">
              <option value={me.email}>Mes tâches</option>
              <option value="all">Toute l’équipe</option>
              <UserOptions exclude={me.email} />
            </select>
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nouvelle tâche</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="kpi-value">{open.length}</span><span className="kpi-label">tâche(s) ouverte(s)</span></div>
        <div className={late ? 'kpi kpi-danger' : 'kpi'}><span className="kpi-value">{late}</span><span className="kpi-label">en retard</span></div>
        <div className="kpi"><span className="kpi-value">{open.filter((r) => r.kind === 'perso').length}</span><span className="kpi-label">personnelle(s)</span></div>
        <div className="kpi"><span className="kpi-value">{open.filter((r) => r.kind === 'projet').length}</span><span className="kpi-label">dans les projets</span></div>
      </div>

      <section className="card">
        {!team && (
          <div className="toolbar-row">
            <input
              className="input quick-add"
              value={quick}
              onChange={(e) => setQuick(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addQuick()}
              placeholder={scope === me.email ? 'Ajouter une tâche personnelle… (Entrée)' : `Ajouter une tâche pour ${name(scope)}… (Entrée)`}
            />
            <button className="btn" disabled={!quick.trim()} onClick={() => void addQuick()}>Ajouter</button>
          </div>
        )}
        <ErrorBox error={data.error} />
        {data.loading && !data.data && <Spinner />}
        {data.data && !open.length && <EmptyState>Aucune tâche ouverte. 🎉</EmptyState>}
        {open.length > 0 && <TaskTable rows={open} team={team} onStatus={setStatus} onEdit={setEditing} statusLabel={(s) => label('task', s)} />}
        {done.length > 0 && (
          <>
            <button className="btn btn-link mt" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Masquer' : 'Afficher'} les {done.length} tâche(s) personnelle(s) terminée(s)
            </button>
            {showDone && <TaskTable rows={done} team={team} onStatus={setStatus} onEdit={setEditing} statusLabel={(s) => label('task', s)} />}
          </>
        )}
      </section>
      {editing && (
        <TodoModal
          task={editing === 'new' ? null : editing}
          defaultAssignee={team ? me.email : scope}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await data.reload();
          }}
        />
      )}
    </div>
  );
}

function UserOptions({ exclude }: { exclude: string }) {
  const { active } = useUsers();
  return (
    <>
      {active.filter((u) => u.email !== exclude).map((u) => (
        <option key={u.email} value={u.email}>{u.name}</option>
      ))}
    </>
  );
}

function TaskTable({
  rows,
  team,
  onStatus,
  onEdit,
  statusLabel,
}: {
  rows: Row[];
  team: boolean;
  onStatus: (r: Row, s: TaskStatus) => void;
  onEdit: (t: PersonalTask) => void;
  statusLabel: (s: string) => string;
}) {
  const { name } = useUsers();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 32 }} />
            <th>Tâche</th>
            {team && <th>Responsable</th>}
            <th>Échéance</th>
            <th>Statut</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.task;
            return (
              <tr key={`${r.kind}-${t.id}`} className={t.status === 'fait' ? 'row-done' : ''}>
                <td>
                  <input type="checkbox" aria-label="Terminée" checked={t.status === 'fait'} onChange={(e) => onStatus(r, e.target.checked ? 'fait' : 'a_faire')} />
                </td>
                <td>
                  {r.kind === 'perso' ? (
                    <button className="btn-link strong-link" onClick={() => onEdit(r.task)}>{t.title}</button>
                  ) : (
                    <Link to={`/projets/${r.task.projectId}?onglet=taches`} className="strong-link">{t.title}</Link>
                  )}
                  <div className="muted small">
                    {r.kind === 'perso' ? (
                      <>Personnelle{r.task.createdBy !== r.task.assigneeId && ` · confiée par ${name(r.task.createdBy)}`}</>
                    ) : (
                      <>📁 {r.task.projectName}</>
                    )}{' '}
                    <PriorityTag priority={t.priority as Priority} hideNormal />
                  </div>
                </td>
                {team && <td className="small nowrap">{r.kind === 'perso' ? name(r.task.assigneeId) : r.task.assignee || '—'}</td>}
                <td className="nowrap"><DueLabel date={t.dueDate} done={t.status === 'fait'} /></td>
                <td>
                  <select className="input input-sm" value={t.status} onChange={(e) => onStatus(r, e.target.value as TaskStatus)} aria-label="Statut">
                    {TASK_STATUSES.map((s) => (
                      <option key={s} value={s}>{statusLabel(s)}</option>
                    ))}
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TodoModal({ task, defaultAssignee, onClose, onSaved }: { task: PersonalTask | null; defaultAssignee: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { me } = useAuth();
  const { label } = useSettings();
  const [f, setF] = useState<Required<TodoInput>>({
    title: task?.title ?? '',
    details: task?.details ?? '',
    status: task?.status ?? 'a_faire',
    priority: task?.priority ?? 'normale',
    dueDate: task?.dueDate ?? '',
    assigneeId: task?.assigneeId ?? defaultAssignee,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={task ? 'Tâche personnelle' : 'Nouvelle tâche personnelle'}
      onClose={onClose}
      footer={
        <>
          {task && (
            <button className="btn btn-danger-ghost" disabled={busy} onClick={() => confirm(`Supprimer « ${task.title} » ?`) && void run(() => api.deleteTodo(task.id))}>
              Supprimer
            </button>
          )}
          <span className="tb-flex" />
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !f.title.trim()} onClick={() => void run(() => (task ? api.updateTodo(task.id, f) : api.createTodo(f)))}>
            {busy && <Spinner small />} Enregistrer
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <label className="field span-2">
          <span>Intitulé *</span>
          <input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field">
          <span>Responsable</span>
          <UserSelect value={f.assigneeId} onChange={(v) => set('assigneeId', v)} only={me.permissions.assignOthers ? undefined : [me.email]} />
        </label>
        <label className="field">
          <span>Échéance</span>
          <input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </label>
        <label className="field">
          <span>Statut</span>
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>{label('task', s)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Priorité</span>
          <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span>Détails</span>
          <textarea className="input" rows={4} value={f.details} onChange={(e) => set('details', e.target.value)} />
        </label>
      </div>
      {!me.permissions.assignOthers && <p className="muted small">Votre rôle permet de créer des tâches pour vous-même ; un responsable d’équipe peut vous en confier.</p>}
    </Modal>
  );
}
