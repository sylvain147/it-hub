import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ticketKey, type Sprint, type Task, type TicketStatus } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { formatDate, shortUser, toast } from '../components/ui';
import { DueLabel, ItemModal, MarkdownField } from '../projects/common';
import { StatusOptions } from '../settings/context';
import { UserSelect, useUsers } from '../users/context';
import { Swatch, useTicketLabel } from './charts';

/**
 * Tickets : travail planifié des projets. Un ticket appartient à un projet, suit les statuts du tableau
 * (paramétrables) et se range dans un sprint ou au backlog. Mêmes composants pour l'onglet « Tickets » d'un projet,
 * la page « Sprints » et la to-do.
 */

/** Ticket, avec son projet quand on le connaît. */
export type TicketRow = Task & { projectId: string; projectName?: string };

export function TicketStatusChip({ status }: { status: TicketStatus }) {
  const label = useTicketLabel();
  return (
    <span className="status-chip">
      <Swatch group={status} /> {label(status)}
    </span>
  );
}

export function TicketKey({ t }: { t: Pick<Task, 'number'> }) {
  return <span className="ticket-key">{ticketKey(t)}</span>;
}

/** Ligne compacte : clé, intitulé, projet, responsable, échéance, statut. Un clic ouvre la fiche. */
export function TicketLine({ t, onOpen, showProject, sprintName, extra }: { t: TicketRow; onOpen: (t: TicketRow) => void; showProject?: boolean; sprintName?: string; extra?: ReactNode }) {
  return (
    <li className={t.done ? 'ticket-line done' : 'ticket-line'}>
      <TicketKey t={t} />
      <button className="ticket-title" onClick={() => onOpen(t)} title="Ouvrir le ticket">{t.title}</button>
      <span className="ticket-meta">
        {showProject && t.projectName && <Link to={`/projets/${t.projectId}?onglet=tickets`} className="small">📁 {t.projectName}</Link>}
        {sprintName && <span className="small muted">{sprintName}</span>}
        {t.assignee && <span className={t.assigneeId ? 'badge' : 'badge badge-ext'} title={t.assigneeId || 'Personne extérieure au hub'}>{t.assignee}</span>}
        {t.dueDate && <span className="small"><DueLabel date={t.dueDate} done={t.done} /></span>}
        <TicketStatusChip status={t.status} />
        {extra}
      </span>
    </li>
  );
}

/** Sprints où l'on peut planifier un ticket : en cours, puis à venir. */
export function useOpenSprints() {
  const data = useLoad(() => api.sprints(), []);
  return (data.data?.sprints ?? []).filter((s) => s.state !== 'closed');
}

export function sprintLabel(s: Pick<Sprint, 'name' | 'state'>) {
  return s.state === 'active' ? `${s.name} (en cours)` : s.name;
}

/** Où se trouve un ticket : son sprint (en cours ou à venir), ou le backlog. */
export function sprintNameOf(t: Pick<Task, 'sprintId'>, sprints: Sprint[]) {
  if (t.sprintId === null) return 'Backlog';
  const s = sprints.find((x) => x.id === t.sprintId);
  return s ? sprintLabel(s) : `Sprint ${t.sprintId}`;
}

/**
 * Création ou modification d'un ticket : intitulé, projet (à la création), statut, sprint, responsable, échéance
 * et description (Markdown).
 */
export function TicketModal({
  ticket,
  defaults,
  sprints,
  onClose,
  onSaved,
}: {
  ticket: TicketRow | null;
  defaults?: { projectId?: string; sprintId?: number | null; status?: TicketStatus };
  /** Sprints en cours et à venir (chargés si absents). */
  sprints?: Sprint[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { me } = useAuth();
  const { name } = useUsers();
  const loaded = useOpenSprints();
  const open = sprints ?? loaded;
  const projects = useLoad(() => api.listProjects(), []);
  const [f, setF] = useState({
    title: ticket?.title ?? '',
    details: ticket?.details ?? '',
    status: ticket?.status ?? defaults?.status ?? ('a_faire' as TicketStatus),
    sprintId: ticket ? ticket.sprintId : (defaults?.sprintId ?? null),
    dueDate: ticket?.dueDate ?? '',
    projectId: ticket?.projectId ?? defaults?.projectId ?? '',
    assigneeId: ticket ? ticket.assigneeId : me.email,
    assignee: ticket && !ticket.assigneeId ? ticket.assignee : '',
  });
  const [external, setExternal] = useState(!!ticket && !ticket.assigneeId);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const who = external ? { assigneeId: '', assignee: f.assignee.trim() } : { assigneeId: f.assigneeId || me.email, assignee: '' };
    const fields = { title: f.title, details: f.details, status: f.status, sprintId: f.sprintId, dueDate: f.dueDate, ...who };
    if (ticket) await api.updateItem(ticket.projectId, 'tasks', ticket.id, fields);
    else await api.createItem(f.projectId, 'tasks', fields);
    await onSaved();
  }

  async function remove() {
    if (!ticket || !confirm(`Supprimer le ticket ${ticketKey(ticket)} « ${ticket.title} » ?`)) return;
    try {
      await api.deleteItem(ticket.projectId, 'tasks', ticket.id);
      toast('Ticket supprimé.');
      onClose();
      await onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const activeProjects = (projects.data ?? []).filter((p) => !['termine', 'abandonne'].includes(p.status));
  const sprintGone = f.sprintId !== null && !open.some((s) => s.id === f.sprintId);

  return (
    <ItemModal
      title={ticket ? `Ticket ${ticketKey(ticket)}` : 'Nouveau ticket'}
      onClose={onClose}
      onSave={save}
      wide
      canSave={!!f.title.trim() && !!f.projectId && (external ? !!f.assignee.trim() : true)}
      extraFooter={
        ticket && (
          <>
            <button className="btn btn-danger-ghost" onClick={() => void remove()}>Supprimer</button>
            <span className="muted small">
              Créé le {formatDate(ticket.createdAt.slice(0, 10))} par {name(ticket.createdBy) === ticket.createdBy ? shortUser(ticket.createdBy) : name(ticket.createdBy)}
              {ticket.done && ticket.doneAt && ` · terminé le ${formatDate(ticket.doneAt.slice(0, 10))}`}
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
        <span>Projet *</span>
        {ticket ? (
          <input className="input" value={ticket.projectName ?? ''} disabled />
        ) : (
          <select className="input" value={f.projectId} onChange={(e) => set('projectId', e.target.value)}>
            <option value="">Choisir un projet…</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        )}
      </label>
      <label className="field">
        <span>Statut</span>
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as TicketStatus)}>
          <StatusOptions list="ticket" current={f.status} />
        </select>
      </label>
      <label className="field">
        <span>Sprint</span>
        <select className="input" value={f.sprintId ?? ''} onChange={(e) => set('sprintId', e.target.value ? Number(e.target.value) : null)}>
          <option value="">Backlog (pas de sprint)</option>
          {sprintGone && <option value={f.sprintId!}>Sprint {f.sprintId} (clos)</option>}
          {open.map((s) => (
            <option key={s.id} value={s.id}>{sprintLabel(s)}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Échéance</span>
        <input className="input" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
      </label>
      <label className="field">
        <span>Responsable</span>
        {external ? (
          <input className="input" value={f.assignee} onChange={(e) => set('assignee', e.target.value)} placeholder="Nom ou société (prestataire, métier…)" />
        ) : (
          <UserSelect value={f.assigneeId || me.email} onChange={(v) => set('assigneeId', v)} />
        )}
        <button type="button" className="btn-link small" onClick={() => setExternal(!external)}>
          {external ? 'Choisir un utilisateur du hub' : 'Personne extérieure au hub…'}
        </button>
      </label>
      <div className="field span-2">
        <span>Description</span>
        <MarkdownField value={f.details} onChange={(v) => set('details', v)} placeholder="Contexte, critères d’acceptation, liens…" resetKey={ticket?.id ?? 'nouveau'} />
      </div>
    </ItemModal>
  );
}
