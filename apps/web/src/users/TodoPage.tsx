import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { byDue, QuickAdd, TaskChecklist, TaskModal, todoRow, type TaskRow } from '../tasks/tasks';
import { sprintNameOf, TicketLine, TicketModal, useOpenSprints, type TicketRow } from '../sprints/tickets';
import { useUsers } from './context';

/** To-do d'une personne (ou de l'équipe) : ses tâches à cocher, et ses tickets ouverts. */
export function TodoPage() {
  const { me } = useAuth();
  const { name, active } = useUsers();
  const [params, setParams] = useSearchParams();
  const scope = me.permissions.seeAllTodos ? (params.get('qui') ?? me.email) : me.email;
  const data = useLoad(() => api.todos(scope), [scope]);
  const sprints = useOpenSprints();
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null);
  const [ticket, setTicket] = useState<TicketRow | null>(null);
  const team = scope === 'all';

  const tickets = data.data?.tickets ?? [];
  const rows = (data.data?.personal ?? []).map((t) => todoRow(t, name, tickets));
  const open = rows.filter((t) => !t.done).sort(byDue);
  const done = rows.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const today = new Date().toISOString().slice(0, 10);
  const late = open.filter((t) => t.dueDate && t.dueDate < today).length;
  const assigned = tickets.filter((t) => !t.done && (team || t.assigneeId === scope));
  const reload = async () => {
    await data.reload();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>To-do</h1>
          <p className="muted small">
            {team ? 'Toute l’équipe' : scope === me.email ? 'Ma to-do' : `To-do de ${name(scope)}`} : des choses à faire, à cocher, liées ou non à un ticket. Les tickets, eux, se
            suivent dans les <Link to="/sprints">sprints</Link>.
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
        <div className="kpi"><span className="kpi-value">{assigned.length}</span><span className="kpi-label">ticket(s) ouvert(s)</span></div>
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

      {data.data && (
        <section className="card">
          <div className="card-head">
            <h2>{team ? 'Tickets ouverts de l’équipe' : scope === me.email ? 'Mes tickets ouverts' : `Tickets ouverts de ${name(scope)}`}</h2>
            <Link to="/sprints" className="small">Tableau du sprint →</Link>
          </div>
          {assigned.length ? (
            <ul className="ticket-list">
              {assigned.map((t) => <TicketLine key={t.id} t={t} onOpen={setTicket} showProject sprintName={sprintNameOf(t, sprints)} />)}
            </ul>
          ) : (
            <p className="muted small">Aucun ticket ouvert.</p>
          )}
        </section>
      )}
      {editing && <TaskModal task={editing === 'new' ? null : editing} defaults={{ assigneeId: team ? me.email : scope }} tickets={tickets} onClose={() => setEditing(null)} onSaved={reload} />}
      {ticket && <TicketModal ticket={ticket} sprints={sprints} onClose={() => setTicket(null)} onSaved={reload} />}
    </div>
  );
}
