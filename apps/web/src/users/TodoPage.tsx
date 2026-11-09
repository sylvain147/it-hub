import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { byDue, QuickAdd, TaskChecklist, TaskModal, todoRow, useProjectRefs, type TaskRow } from '../tasks/tasks';
import { useUsers } from './context';

/** To-do d'une personne (ou de l'équipe) : ses tâches à cocher, rattachées ou non à un projet. Les tickets sont à part (sprints). */
export function TodoPage() {
  const { me } = useAuth();
  const { name, active } = useUsers();
  const [params, setParams] = useSearchParams();
  const scope = me.permissions.seeAllTodos ? (params.get('qui') ?? me.email) : me.email;
  const data = useLoad(() => api.todos(scope), [scope]);
  const projects = useProjectRefs();
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null);
  const team = scope === 'all';

  const rows = (data.data?.personal ?? []).map((t) => todoRow(t, name, projects));
  const open = rows.filter((t) => !t.done).sort(byDue);
  const done = rows.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const today = new Date().toISOString().slice(0, 10);
  const late = open.filter((t) => t.dueDate && t.dueDate < today).length;
  const reload = async () => {
    await data.reload();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>To-do</h1>
          <p className="muted small">
            {team ? 'Toute l’équipe' : scope === me.email ? 'Ma to-do' : `To-do de ${name(scope)}`} : des choses à faire, à cocher, rattachées ou non à un projet. Elle est
            indépendante des tickets, qui se planifient dans les <Link to="/sprints">sprints</Link>.
          </p>
        </div>
        <div className="actions">
          {me.permissions.seeAllTodos && (
            <select className="input input-auto" value={scope} onChange={(e) => setParams(e.target.value === me.email ? {} : { qui: e.target.value }, { replace: true })} aria-label="To-do de">
              <option value={me.email}>Ma to-do</option>
              <option value="all">Toute l’équipe</option>
              {active.filter((u) => u.email !== me.email).map((u) => (
                <option key={u.email} value={u.email}>{u.name}</option>
              ))}
            </select>
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nouvelle tâche</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="kpi-value">{open.length}</span><span className="kpi-label">à faire</span></div>
        <div className={late ? 'kpi kpi-danger' : 'kpi'}><span className="kpi-value">{late}</span><span className="kpi-label">en retard</span></div>
      </div>

      <section className="card">
        {!team && (
          <div className="toolbar-row">
            <QuickAdd
              placeholder={scope === me.email ? 'Ajouter à ma to-do… (Entrée)' : `Ajouter à la to-do de ${name(scope)}… (Entrée)`}
              onAdd={async (title) => {
                await api.createTodo({ title, assigneeId: scope });
                await data.reload();
              }}
            />
          </div>
        )}
        <ErrorBox error={data.error} />
        {data.loading && !data.data && <Spinner />}
        {data.data && !open.length && <EmptyState>Rien à faire. 🎉</EmptyState>}
        {open.length > 0 && <TaskChecklist rows={open} onChanged={reload} onEdit={setEditing} showAssignee={team || scope !== me.email} />}
        {done.length > 0 && (
          <>
            <button className="btn btn-link mt" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Masquer' : 'Afficher'} les {done.length} tâche(s) faite(s)
            </button>
            {showDone && <TaskChecklist rows={done} onChanged={reload} onEdit={setEditing} showAssignee={team} />}
          </>
        )}
      </section>

      {editing && <TaskModal task={editing === 'new' ? null : editing} defaults={{ assigneeId: team ? me.email : scope }} projects={projects} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
