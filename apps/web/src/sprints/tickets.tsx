import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { deskKey, NO_PROJECT_ID, NO_PROJECT_LABEL, PRIORITIES, PRIORITY_LABELS, ticketKey, type DeskTicketInfo, type Priority, type Sprint, type Task, type TicketStatus } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { formatDate, shortUser, toast } from '../components/ui';
import { DueLabel, ItemModal, MarkdownField, PriorityTag } from '../projects/common';
import { StatusOptions } from '../settings/context';
import { UserSelect, useUsers } from '../users/context';
import { Swatch, useTicketLabel } from './charts';

/**
 * Tickets : travail planifié. Un ticket appartient à un projet ou reste hors projet (`NO_PROJECT_ID`), suit les
 * statuts du tableau (paramétrables) et se range dans un sprint ou au backlog. Mêmes composants pour l'onglet
 * « Tickets » d'un projet et la page « Sprints ».
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
        {showProject && t.projectName && <TicketProject t={t} />}
        <PriorityTag priority={t.priority} hideNormal />
        {sprintName && <span className="small muted">{sprintName}</span>}
        {t.deskId && <DeskBadge id={t.deskId} />}
        {t.assignee && <span className={t.assigneeId ? 'badge' : 'badge badge-ext'} title={t.assigneeId || 'Personne extérieure au hub'}>{t.assignee}</span>}
        {t.dueDate && <span className="small"><DueLabel date={t.dueDate} done={t.done} /></span>}
        <TicketStatusChip status={t.status} />
        {extra}
      </span>
    </li>
  );
}

/** Projet d'un ticket : lien vers ses tickets, ou « Hors projet ». */
export function TicketProject({ t }: { t: Pick<TicketRow, 'projectId' | 'projectName'> }) {
  if (t.projectId === NO_PROJECT_ID) return <span className="small muted">{NO_PROJECT_LABEL}</span>;
  return <Link to={`/projets/${t.projectId}?onglet=tickets`} className="small">📁 {t.projectName}</Link>;
}

/** Numéro du ticket Desk du prestataire. */
export function DeskBadge({ id }: { id: string }) {
  return <span className="badge badge-desk" title="Ticket Desk du prestataire">Desk #{id}</span>;
}

const fmtHours = (h: number) => `${h.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} h`;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthShort = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

/** Ce que le suivi TMA sait du ticket Desk : sujet, statut, temps passé par le prestataire, autres tickets du hub. */
function DeskInfo({ id, ticketId }: { id: string; ticketId: string | null }) {
  const [info, setInfo] = useState<DeskTicketInfo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setInfo(null);
    setError('');
    if (!/^\d{1,9}$/.test(id)) return;
    // Petite attente : pas d'appel à chaque chiffre tapé.
    const timer = setTimeout(() => {
      api.deskTicket(id).then(setInfo, (e: Error) => setError(e.message));
    }, 400);
    return () => clearTimeout(timer);
  }, [id]);
  if (error) return <span className="small due-late">{error}</span>;
  if (!info) return null;
  const others = info.hubTickets.filter((h) => h.id !== ticketId);
  return (
    <div className="desk-info small">
      {info.ticket ? (
        <>
          <strong>{info.ticket.subject}</strong>
          <div className="muted">{[info.ticket.status, info.ticket.category, info.ticket.theme].filter(Boolean).join(' · ')}</div>
        </>
      ) : (
        <div className="muted">Ticket absent des exports Desk importés dans le suivi TMA.</div>
      )}
      <div>
        Temps passé par le prestataire : <strong>{fmtHours(info.hours)}</strong>
        {info.months.length > 0 && (
          <span className="muted">
            {' '}(
            {info.months.map((m, i) => (
              <span key={m.month}>
                {i > 0 && ', '}
                <Link to={`/tma/mois/${m.month}`}>{monthShort(m.month)}</Link> {fmtHours(m.hours)}
              </span>
            ))}
            )
          </span>
        )}
      </div>
      {others.length > 0 && (
        <div className="muted">
          Aussi cité par :{' '}
          {others.map((h, i) => (
            <span key={h.id}>
              {i > 0 && ', '}
              {h.key} « {h.title} » ({h.projectName})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Page où retrouver un ticket : son projet, ou les sprints s'il est hors projet. */
export const ticketPath = (t: Pick<TicketRow, 'projectId'>) => (t.projectId === NO_PROJECT_ID ? '/sprints' : `/projets/${t.projectId}?onglet=tickets`);

/** Planifie d'un coup tous les tickets d'un projet restés au backlog dans un sprint en cours ou à venir. */
export function PlanProjectBar({ projectId, projectName, count, open, onDone }: { projectId: string; projectName: string; count: number; open: Sprint[]; onDone: () => Promise<void> | void }) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  if (!count || !open.length) return null;
  async function plan() {
    setBusy(true);
    try {
      const r = await api.planProject(Number(target), projectId);
      toast(`${r.planned} ticket${r.planned > 1 ? 's' : ''} planifié${r.planned > 1 ? 's' : ''} dans « ${open.find((s) => s.id === Number(target))?.name ?? ''} ».`);
      setTarget('');
      await onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="toolbar-row plan-project">
      <span className="small">
        Planifier tout le projet <strong>{projectName}</strong> ({count} ticket{count > 1 ? 's' : ''} au backlog) dans
      </span>
      <select className="input input-sm input-auto" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Sprint">
        <option value="">choisir un sprint…</option>
        {open.map((s) => <option key={s.id} value={s.id}>{sprintLabel(s)}</option>)}
      </select>
      <button className="btn btn-sm btn-primary" disabled={!target || busy} onClick={() => void plan()}>Planifier</button>
    </div>
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
    priority: ticket?.priority ?? ('normale' as Priority),
    sprintId: ticket ? ticket.sprintId : (defaults?.sprintId ?? null),
    dueDate: ticket?.dueDate ?? '',
    deskId: ticket?.deskId ?? '',
    projectId: ticket?.projectId ?? defaults?.projectId ?? '',
    assigneeId: ticket ? ticket.assigneeId : me.email,
    assignee: ticket && !ticket.assigneeId ? ticket.assignee : '',
  });
  const [external, setExternal] = useState(!!ticket && !ticket.assigneeId);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const who = external ? { assigneeId: '', assignee: f.assignee.trim() } : { assigneeId: f.assigneeId || me.email, assignee: '' };
    const fields = { title: f.title, details: f.details, status: f.status, priority: f.priority, sprintId: f.sprintId, dueDate: f.dueDate, deskId: f.deskId, ...who };
    // Changer le projet déplace le ticket (même numéro, même historique).
    if (ticket) await api.updateItem(ticket.projectId, 'tasks', ticket.id, f.projectId !== ticket.projectId ? { ...fields, projectId: f.projectId } : fields);
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
        <select className="input" value={f.projectId} onChange={(e) => set('projectId', e.target.value)}>
          {!ticket && <option value="">Choisir un projet…</option>}
          <option value={NO_PROJECT_ID}>{NO_PROJECT_LABEL}</option>
          {ticket && ticket.projectId !== NO_PROJECT_ID && !activeProjects.some((p) => p.id === ticket.projectId) && <option value={ticket.projectId}>{ticket.projectName}</option>}
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {ticket && f.projectId !== ticket.projectId && <span className="muted small">Le ticket sera déplacé ; il garde son numéro et son historique.</span>}
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
        <span>Priorité</span>
        <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
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
        <span>N° ticket Desk (prestataire)</span>
        <input
          className="input input-desk"
          aria-label="N° ticket Desk"
          inputMode="numeric"
          value={f.deskId}
          onChange={(e) => set('deskId', e.target.value.replace(/[^\d]/g, '').slice(0, 9))}
          placeholder="ex. 48213"
        />
        {f.deskId && <DeskInfo id={deskKey(f.deskId)} ticketId={ticket?.id ?? null} />}
      </div>
      <div className="field span-2">
        <span>Description</span>
        <MarkdownField value={f.details} onChange={(v) => set('details', v)} placeholder="Contexte, critères d’acceptation, liens…" resetKey={ticket?.id ?? 'nouveau'} />
      </div>
    </ItemModal>
  );
}
