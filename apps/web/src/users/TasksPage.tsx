import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { byDue, personalRow, projectRow, QuickAdd, TaskChecklist, TaskModal, type TaskRow } from '../tasks/tasks';
import { useUsers } from './context';

/** Tâches d'une personne (ou de l'équipe) : tâches ouvertes des projets et tâches personnelles, à cocher. */
export function TasksPage() {
  const { me } = useAuth();
  const { name, active } = useUsers();
  const [params, setParams] = useSearchParams();
  const scope = me.permissions.seeAllTodos ? (params.get('qui') ?? me.email) : me.email;
  const data = useLoad(() => api.todos(scope), [scope]);
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null);
  // Tâches de projet cochées pendant la visite : elles restent affichées (barrées) pour pouvoir être décochées.
  const [justDone, setJustDone] = useState<TaskRow[]>([]);
  const team = scope === 'all';

  const personal = (data.data?.personal ?? []).map((t) => personalRow(t, name));
  const project = (data.data?.project ?? []).map((t) => projectRow(t, t.projectId, t.projectName));
  const openIds = new Set(project.map((t) => t.id));
  const recent = justDone.filter((t) => !openIds.has(t.id));
  const open = [...personal.filter((t) => !t.done), ...project, ...recent].sort((a, b) => Number(a.done) - Number(b.done) || byDue(a, b));
  const done = personal.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const today = new Date().toISOString().slice(0, 10);
  const late = open.filter((t) => !t.done && t.dueDate && t.dueDate < today).length;

  async function changed() {
    const before = project;
    const res = await data.reload();
    const stillOpen = new Set((res?.project ?? []).map((t) => t.id));
    // Une tâche de projet qui vient d'être cochée disparaît de la liste des tâches ouvertes : on la garde à l'écran.
    const closed = before.filter((t) => !stillOpen.has(t.id)).map((t) => ({ ...t, done: true }));
    setJustDone((xs) => [...xs.filter((x) => !stillOpen.has(x.id) && !closed.some((c) => c.id === x.id)), ...closed]);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tâches</h1>
          <p className="muted small">
            {team ? 'Toute l’équipe' : scope === me.email ? 'Mes tâches' : `Tâches de ${name(scope)}`} : tâches des projets et tâches personnelles (hors projet). Cochez-les
            quand elles sont faites.
          </p>
        </div>
        <div className="actions">
          {me.permissions.seeAllTodos && (
            <select className="input input-auto" value={scope} onChange={(e) => setParams(e.target.value === me.email ? {} : { qui: e.target.value }, { replace: true })} aria-label="Tâches de">
              <option value={me.email}>Mes tâches</option>
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
        <div className="kpi"><span className="kpi-value">{open.filter((t) => !t.done).length}</span><span className="kpi-label">tâche(s) à faire</span></div>
        <div className={late ? 'kpi kpi-danger' : 'kpi'}><span className="kpi-value">{late}</span><span className="kpi-label">en retard</span></div>
        <div className="kpi"><span className="kpi-value">{open.filter((t) => !t.done && !t.projectId).length}</span><span className="kpi-label">personnelle(s)</span></div>
        <div className="kpi"><span className="kpi-value">{open.filter((t) => !t.done && t.projectId).length}</span><span className="kpi-label">dans les projets</span></div>
      </div>

      <section className="card">
        {!team && (
          <div className="toolbar-row">
            <QuickAdd
              placeholder={scope === me.email ? 'Ajouter une tâche personnelle… (Entrée)' : `Ajouter une tâche pour ${name(scope)}… (Entrée)`}
              onAdd={async (title) => {
                await api.createTodo({ title, assigneeId: scope });
                await data.reload();
              }}
            />
          </div>
        )}
        <ErrorBox error={data.error} />
        {data.loading && !data.data && <Spinner />}
        {data.data && !open.length && <EmptyState>Aucune tâche à faire. 🎉</EmptyState>}
        {open.length > 0 && <TaskChecklist rows={open} onChanged={changed} onEdit={setEditing} showProject showAssignee={team || scope !== me.email} />}
        {done.length > 0 && (
          <>
            <button className="btn btn-link mt" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Masquer' : 'Afficher'} les {done.length} tâche(s) personnelle(s) faite(s)
            </button>
            {showDone && <TaskChecklist rows={done} onChanged={changed} onEdit={setEditing} showProject showAssignee={team} />}
          </>
        )}
      </section>
      {editing && (
        <TaskModal
          task={editing === 'new' ? null : editing}
          defaults={{ projectId: '', assigneeId: team ? me.email : scope }}
          onClose={() => setEditing(null)}
          onSaved={changed}
        />
      )}
    </div>
  );
}
