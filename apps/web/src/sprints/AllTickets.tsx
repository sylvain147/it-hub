import { useMemo, useState } from 'react';
import { boardOf, ticketKey, type Board, type TicketStatus } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { DueLabel, PriorityTag } from '../projects/common';
import { StatusOptions } from '../settings/context';
import { boardPrefix } from './boards';
import { DeskBadge, sprintLabel, TicketModal, TicketProject, TicketStatusChip, TicketTypeBadge, type TicketRow } from './tickets';

/** Texte comparable : minuscules, sans accents. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Onglet « Tous les tickets » de la page Tickets : tous les tickets (projets et hors projet, terminés compris) du tableau
 * affiché, ou de tous les tableaux, avec recherche (numéro, intitulé, projet, responsable, ticket Desk) et filtre par
 * statut. Un clic ouvre la fiche.
 */
export function AllTickets({ boards, boardId, mineIds, onChanged }: { boards: Board[]; boardId: string; mineIds: Set<string> | null; onChanged: () => Promise<void> }) {
  const data = useLoad(() => api.allTickets(), []);
  const sprints = useLoad(() => api.allSprints(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TicketStatus | 'ouverts' | ''>('');
  // Vide : tous les tableaux.
  const [board, setBoard] = useState(boardId);
  const [editing, setEditing] = useState<TicketRow | null>(null);
  const sprintName = useMemo(() => new Map((sprints.data ?? []).map((s) => [s.id, (board ? '' : boardPrefix(boards, s.boardId)) + sprintLabel(s)])), [sprints.data, boards, board]);

  const rows = useMemo(() => {
    const needle = fold(q.trim());
    return (data.data ?? []).filter((t) => {
      if (mineIds && !mineIds.has(t.projectId)) return false;
      if (board && boardOf(t) !== board) return false;
      if (status === 'ouverts' ? t.done : status && t.status !== status) return false;
      if (!needle) return true;
      return [ticketKey(t), t.title, t.type, t.projectName, t.assignee, t.deskId, t.deskId && `desk #${t.deskId}`].some((s) => s && fold(s).includes(needle));
    });
  }, [data.data, q, status, mineIds, board]);

  return (
    <section className="card">
      <div className="filters">
        <input className="input" autoFocus placeholder="Rechercher (numéro, intitulé, projet, responsable, ticket Desk)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input input-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Statut">
          <option value="">Tous les statuts</option>
          <option value="ouverts">Non terminés</option>
          <StatusOptions list="ticket" />
        </select>
        {boards.length > 1 && (
          <select className="input input-auto" value={board} onChange={(e) => setBoard(e.target.value)} aria-label="Tableau">
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="">Tous les tableaux</option>
          </select>
        )}
        {data.data && <span className="muted small">{rows.length} ticket{rows.length > 1 ? 's' : ''}</span>}
      </div>
      <ErrorBox error={data.error} />
      {!data.data && !data.error && <Spinner />}
      {data.data && !rows.length && <EmptyState>{data.data.length ? 'Aucun ticket ne correspond à la recherche.' : 'Aucun ticket pour l’instant.'}</EmptyState>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Clé</th>
                <th>Intitulé</th>
                <th>Projet</th>
                <th>Statut</th>
                <th>Sprint</th>
                <th>Responsable</th>
                <th>Desk</th>
                <th>Échéance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.done ? 'row-done' : ''}>
                  <td className="nowrap ticket-key">{ticketKey(t)}</td>
                  <td>
                    <TicketTypeBadge type={t.type ?? ''} /> <button className="btn-link" onClick={() => setEditing(t)} title="Ouvrir le ticket">{t.title}</button> <PriorityTag priority={t.priority} hideNormal />
                  </td>
                  <td><TicketProject t={t} /></td>
                  <td className="nowrap"><TicketStatusChip status={t.status} /></td>
                  <td className="nowrap small">{t.sprintId === null ? <span className="muted">Backlog</span> : (sprintName.get(t.sprintId) ?? `Sprint ${t.sprintId}`)}</td>
                  <td className="nowrap small">{t.assignee || <span className="muted">–</span>}</td>
                  <td className="nowrap">{t.deskId ? <DeskBadge id={t.deskId} /> : <span className="muted">–</span>}</td>
                  <td className="nowrap small">{t.dueDate ? <DueLabel date={t.dueDate} done={t.done} /> : <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TicketModal ticket={editing} onClose={() => setEditing(null)} onSaved={async () => { await Promise.all([data.reload(), onChanged()]); }} />}
    </section>
  );
}
