import { useState } from 'react';
import { Link } from 'react-router';
import { byTicketPriority } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { EmptyState } from '../components/ui';
import { useProject } from './common';
import { QuickAdd } from '../tasks/tasks';
import { PlanProjectBar, sprintNameOf, TicketLine, TicketModal, useOpenSprints, type TicketRow } from '../sprints/tickets';

/** Onglet « Tickets » d'un projet : ses tickets, au backlog ou planifiés dans un sprint. */
export function TicketsTab() {
  const { project, reload } = useProject();
  const { email } = useAuth();
  const sprints = useOpenSprints();
  const [editing, setEditing] = useState<TicketRow | 'new' | null>(null);
  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const rows: TicketRow[] = project.items.tasks.map((t) => ({ ...t, projectId: project.id, projectName: project.name })).filter((t) => !mine || t.assigneeId === email);
  // Sprint en cours, puis sprints à venir, puis backlog.
  const rank = (t: TicketRow) => (t.sprintId === null ? 1e6 : (sprints.findIndex((s) => s.id === t.sprintId) + 1 || 1e5));
  const open = rows.filter((t) => !t.done).sort((a, b) => rank(a) - rank(b) || byTicketPriority(a, b));
  const backlog = project.items.tasks.filter((t) => !t.done && t.sprintId === null).length;
  const done = rows.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));

  return (
    <div>
      <section className="card">
        <div className="toolbar-row">
          <QuickAdd placeholder="+ Nouveau ticket au backlog : tapez l’intitulé puis Entrée" onAdd={async (title) => { await api.createItem(project.id, 'tasks', { title }); await reload(); }} />
          <button className="btn btn-ghost" onClick={() => setEditing('new')}>Avec des détails…</button>
          <span className="tb-flex" />
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Seulement les miens
          </label>
        </div>
        <PlanProjectBar projectId={project.id} projectName={project.name} count={backlog} open={sprints} onDone={reload} />
        {!project.items.tasks.length ? (
          <EmptyState>Aucun ticket. Ajoutez-en ci-dessus, ou faites-les proposer par l’assistant à partir d’un compte rendu de réunion (onglet Journal).</EmptyState>
        ) : (
          <>
            {open.length ? (
              <ul className="ticket-list">
                {open.map((t) => <TicketLine key={t.id} t={t} onOpen={setEditing} sprintName={sprintNameOf(t, sprints)} />)}
              </ul>
            ) : (
              <p className="muted">Tous les tickets sont terminés. 🎉</p>
            )}
            {done.length > 0 && (
              <>
                <button className="btn-link small mt" onClick={() => setShowDone(!showDone)}>
                  {showDone ? 'Masquer' : 'Afficher'} les {done.length} ticket{done.length > 1 ? 's' : ''} terminé{done.length > 1 ? 's' : ''}
                </button>
                {showDone && (
                  <ul className="ticket-list">
                    {done.map((t) => <TicketLine key={t.id} t={t} onOpen={setEditing} />)}
                  </ul>
                )}
              </>
            )}
          </>
        )}
        <p className="muted small mt">
          Les tickets se planifient dans les sprints et avancent sur le tableau du sprint en cours : <Link to="/sprints">page Sprints</Link>.
        </p>
      </section>
      {editing && (
        <TicketModal
          ticket={editing === 'new' ? null : editing}
          defaults={{ projectId: project.id }}
          sprints={sprints}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
