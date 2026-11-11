import { useState } from 'react';
import { Link } from 'react-router';
import { byTicketPriority, ticketTypeTitle } from '@samm/shared';
import { useAuth } from '../auth';
import { EmptyState } from '../components/ui';
import { useProject } from './common';
import { useSettings } from '../settings/context';
import { TicketProcessDialog } from './TicketProcessDialog';
import { PlanProjectBar, sprintNameOf, TicketLine, TicketModal, useOpenSprints, type TicketRow } from '../sprints/tickets';

/** Onglet « Tickets » d'un projet : ses tickets, au backlog ou planifiés dans un sprint. */
export function TicketsTab() {
  const { project, reload } = useProject();
  const { email } = useAuth();
  const sprints = useOpenSprints();
  const { lists } = useSettings();
  // Nouveau ticket : type choisi (« » : sans type, le type est facultatif), ou ticket ouvert.
  const [editing, setEditing] = useState<TicketRow | { type: string } | null>(null);
  const [mine, setMine] = useState(false);
  const [process, setProcess] = useState(false);
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
          <span className="strong">+ Nouveau ticket :</span>
          {lists.ticketTypes.map((t) => (
            <button key={t} className="btn btn-sm" onClick={() => setEditing({ type: t })} title={`Titre proposé : ${ticketTypeTitle(t, project.name)}`}>{t}</button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ type: '' })}>Sans type</button>
          <button className="btn btn-sm btn-primary" onClick={() => setProcess(true)} title="Crée d’un coup les tickets Cadrage, Dev, Recette, Correctif et MEP">⚡ Process complet</button>
          <span className="tb-flex" />
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Seulement les miens
          </label>
        </div>
        <PlanProjectBar projectId={project.id} projectName={project.name} count={backlog} open={sprints} onDone={reload} />
        {!project.items.tasks.length ? (
          <EmptyState>Aucun ticket. Choisissez un type ci-dessus pour en créer un, « Process complet » pour créer d’un coup les tickets de cadrage, dev, recette, correctif et MEP, ou faites-les proposer par l’assistant à partir d’un compte rendu de réunion (onglet Journal).</EmptyState>
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
          Les tickets se planifient dans les sprints et avancent sur le tableau du sprint en cours : <Link to="/sprints">page Tickets</Link>.
        </p>
      </section>
      {process && <TicketProcessDialog sprints={sprints} onClose={() => setProcess(false)} />}
      {editing && (
        <TicketModal
          ticket={'id' in editing ? editing : null}
          defaults={{ projectId: project.id, projectName: project.name, type: 'id' in editing ? undefined : editing.type }}
          sprints={sprints}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
