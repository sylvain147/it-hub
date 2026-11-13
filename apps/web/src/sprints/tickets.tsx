import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { boardOf, deskKey, formatDuration, NO_PROJECT_ID, NO_PROJECT_LABEL, parseDuration, PRIORITIES, PRIORITY_LABELS, ticketKey, ticketTypeKey, type DeskTicketInfo, type Priority, type Sprint, type Task, type TicketComment, type TicketStatus } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { boardPrefix, useBoards, useDefaultBoardId } from './boards';
import { formatDate, shortUser, toast } from '../components/ui';
import { DueLabel, ItemModal, MarkdownField, MarkdownView, PriorityTag } from '../projects/common';
import { StatusOptions, useSettings } from '../settings/context';
import { UserSelect, useUsers } from '../users/context';
import { Swatch, useTicketLabel } from './charts';

/**
 * Tickets : travail planifié. Un ticket appartient à un projet ou reste hors projet (`NO_PROJECT_ID`), suit les
 * statuts du tableau (paramétrables) et se range dans un sprint ou au backlog. Mêmes composants pour l'onglet
 * « Tickets » d'un projet et la page « Sprints ».
 */

/** Projet d'un ticket dans les formulaires : vide pour « aucun projet » (`NO_PROJECT_ID` côté serveur). */
const formProjectId = (id: string) => (id === NO_PROJECT_ID ? '' : id);

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

/** Libellé d'un type de ticket tel qu'au paramétrage (« DEV » d'un ancien ticket → « Dev »). */
export function useTicketTypeLabel() {
  const { lists } = useSettings();
  return (type: string) => lists.ticketTypes.find((t) => ticketTypeKey(t) === ticketTypeKey(type)) ?? type;
}

/** Type d'un ticket (Cadrage, Dev…) en étiquette ; rien s'il n'en a pas. */
export function TicketTypeBadge({ type }: { type: string }) {
  const label = useTicketTypeLabel();
  if (!type.trim()) return null;
  return <span className={`badge ticket-type ticket-type-${ticketTypeKey(type).replace(/[^a-z0-9]+/g, '-')}`}>{label(type)}</span>;
}

/** Ligne compacte : clé, intitulé, projet, responsable, échéance, statut. Un clic ouvre la fiche. */
export function TicketLine({ t, onOpen, showProject, sprintName, extra }: { t: TicketRow; onOpen: (t: TicketRow) => void; showProject?: boolean; sprintName?: string; extra?: ReactNode }) {
  return (
    <li className={t.done ? 'ticket-line done' : 'ticket-line'}>
      <TicketKey t={t} />
      <TicketTypeBadge type={t.type ?? ''} />
      <button className="ticket-title" onClick={() => onOpen(t)} title="Ouvrir le ticket">{t.title}</button>
      <span className="ticket-meta">
        {showProject && t.projectName && <TicketProject t={t} />}
        <PriorityTag priority={t.priority} hideNormal />
        {sprintName && <span className="small muted">{sprintName}</span>}
        {t.deskId && <DeskBadge id={t.deskId} />}
        {t.assignee && <span className={t.assigneeId ? 'badge' : 'badge badge-ext'} title={t.assigneeId || 'Personne extérieure au hub'}>{t.assignee}</span>}
        {t.dueDate && <span className="small"><DueLabel date={t.dueDate} done={t.done} /></span>}
        {t.comments?.length > 0 && <span className="small muted" title={`${t.comments.length} note${t.comments.length > 1 ? 's' : ''} de suivi`}>💬 {t.comments.length}</span>}
        <TicketTimes t={t} />
        <TicketStatusChip status={t.status} />
        {extra}
      </span>
    </li>
  );
}

/** Temps estimé et temps passé d'un ticket (rien s'ils ne sont pas renseignés). */
export function TicketTimes({ t }: { t: Pick<Task, 'estimatedHours' | 'spentHours'> }) {
  if (t.estimatedHours == null && t.spentHours == null) return null;
  return (
    <span className="small muted ticket-times" title="Temps estimé · temps passé">
      {t.estimatedHours != null && <>⏳ {fmtHours(t.estimatedHours)}</>}
      {t.estimatedHours != null && t.spentHours != null && ' · '}
      {t.spentHours != null && <>⏱ {fmtHours(t.spentHours)}</>}
    </span>
  );
}

/** Saisie d'une durée en jours et heures (« 1j 4h », journée de 8 h ; un nombre seul est en heures) ; vide : non renseignée. */
function HoursInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const hours = parseDuration(value);
  const invalid = hours != null && Number.isNaN(hours);
  return (
    <span className="hours-input">
      <input
        className="input"
        aria-label={label}
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ex. 1j 4h"
        title="Jours (j ou d, journée de 8 h) et heures (h) : 1j 4h, 2d, 1,5j, 3h30. Un nombre seul est en heures."
      />
      {invalid ? <span className="small due-late">Durée illisible (ex. 1j 4h)</span> : hours != null && /[jd]/i.test(value) && <span className="muted small">= {fmtHours(hours)}</span>}
    </span>
  );
}

/** Texte saisi → heures (null si vide, NaN si invalide). */
const parseHours = parseDuration;
const hoursText = (h: number | null | undefined) => (h == null ? '' : formatDuration(h));

/** Projet d'un ticket : lien vers ses tickets, ou « Hors projet ». */
export function TicketProject({ t }: { t: Pick<TicketRow, 'projectId' | 'projectName'> }) {
  if (t.projectId === NO_PROJECT_ID) return <span className="small muted">{NO_PROJECT_LABEL}</span>;
  return <Link to={`/projets/${t.projectId}?onglet=tickets`} className="small">📁 {t.projectName}</Link>;
}

/** Numéro du ticket Desk du prestataire. */
export function DeskBadge({ id }: { id: string }) {
  return <span className="badge badge-desk" title="Ticket Desk du prestataire">Desk #{id}</span>;
}

const fmtHours = formatDuration;
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

/**
 * Sprints où l'on peut planifier un ticket, tous tableaux confondus : en cours, puis à venir. Avec plusieurs tableaux,
 * leur nom est précédé de celui de leur tableau (« Support · Sprint 3 »).
 */
export function useOpenSprints(): Sprint[] {
  const data = useLoad(() => api.allSprints(), []);
  const boards = useBoards();
  const rank = { active: 0, future: 1, closed: 2 } as const;
  return (data.data ?? [])
    .filter((s) => s.state !== 'closed')
    .map((s) => ({ ...s, name: boardPrefix(boards, s.boardId) + s.name }))
    .sort((a, b) => rank[a.state] - rank[b.state] || a.id - b.id);
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
 * et description (Markdown). Type facultatif (paramétrage `ticketTypes`) ; à la création, l'intitulé proposé est le nom du projet.
 */
export function TicketModal({
  ticket,
  defaults,
  sprints,
  onClose,
  onSaved,
}: {
  ticket: TicketRow | null;
  /** Valeurs d'un nouveau ticket ; `boardId` : tableau de la page d'où on le crée (sinon mon tableau par défaut). */
  defaults?: { projectId?: string; projectName?: string; sprintId?: number | null; status?: TicketStatus; type?: string; boardId?: string };
  /** Sprints en cours et à venir de tous les tableaux (chargés si absents). */
  sprints?: Sprint[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { me } = useAuth();
  const { name } = useUsers();
  const loaded = useOpenSprints();
  const allOpen = sprints ?? loaded;
  const boards = useBoards();
  const myBoard = useDefaultBoardId(boards);
  const projects = useLoad(() => api.listProjects(), []);
  const { lists } = useSettings();
  const typeLabel = useTicketTypeLabel();
  const [type, setType] = useState(ticket ? typeLabel(ticket.type ?? '') : (defaults?.type ?? ''));
  // Tant que l'intitulé n'a pas été retouché, il suit le type et le projet choisis.
  const [titleTouched, setTitleTouched] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  // Curseur en fin d'intitulé, pour compléter directement le nom du projet proposé.
  const focusTitleEnd = () =>
    requestAnimationFrame(() => {
      const el = titleRef.current;
      el?.focus();
      el?.setSelectionRange(el.value.length, el.value.length);
    });
  useEffect(() => {
    if (!ticket) focusTitleEnd();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState({
    title: ticket?.title ?? (defaults?.type && formProjectId(defaults.projectId ?? '') ? (defaults.projectName ?? '') : ''),
    details: ticket?.details ?? '',
    status: ticket?.status ?? defaults?.status ?? ('a_faire' as TicketStatus),
    priority: ticket?.priority ?? ('normale' as Priority),
    sprintId: ticket ? ticket.sprintId : (defaults?.sprintId ?? null),
    // Vide : mon tableau par défaut (connu une fois les tableaux chargés).
    boardId: ticket ? boardOf(ticket) : (defaults?.boardId ?? ''),
    dueDate: ticket?.dueDate ?? '',
    deskId: ticket?.deskId ?? '',
    // Vide : aucun projet (le ticket est enregistré hors projet).
    projectId: formProjectId(ticket?.projectId ?? defaults?.projectId ?? ''),
    assigneeId: ticket ? ticket.assigneeId : me.email,
    assignee: ticket && !ticket.assigneeId ? ticket.assignee : '',
    estimatedHours: hoursText(ticket?.estimatedHours),
    spentHours: hoursText(ticket?.spentHours),
  });
  const [external, setExternal] = useState(!!ticket && !ticket.assigneeId);
  // Note de suivi saisie mais pas encore ajoutée : enregistrée avec le ticket.
  const [noteDraft, setNoteDraft] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const who = external ? { assigneeId: '', assignee: f.assignee.trim() } : { assigneeId: f.assigneeId || me.email, assignee: '' };
    const times = { estimatedHours: parseHours(f.estimatedHours), spentHours: parseHours(f.spentHours) };
    const fields = { title: f.title, type, details: f.details, status: f.status, priority: f.priority, sprintId: f.sprintId, boardId: f.boardId, dueDate: f.dueDate, deskId: f.deskId, ...times, ...who };
    // Changer le projet déplace le ticket (même numéro, même historique).
    const projectId = f.projectId || NO_PROJECT_ID;
    if (ticket) {
      if (noteDraft.trim()) await api.addTicketNote(ticket.projectId, ticket.id, noteDraft);
      await api.updateItem(ticket.projectId, 'tasks', ticket.id, projectId !== ticket.projectId ? { ...fields, projectId } : fields);
    } else await api.createItem(projectId, 'tasks', fields);
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
  const projectName = !f.projectId ? '' : ((projects.data ?? []).find((p) => p.id === f.projectId)?.name ?? (f.projectId === defaults?.projectId ? (defaults?.projectName ?? '') : ''));
  const moved = !!ticket && (f.projectId || NO_PROJECT_ID) !== ticket.projectId;
  useEffect(() => {
    if (!ticket && !titleTouched) set('title', type ? projectName : '');
  }, [type, projectName]); // eslint-disable-line react-hooks/exhaustive-deps
  // Le type est facultatif : un second clic sur le type choisi le retire.
  function chooseType(choice: string) {
    setType(choice === type ? '' : choice);
    if (!ticket) focusTitleEnd();
  }
  // Type d'un ancien ticket absent du paramétrage : proposé quand même.
  const typeChoices = type && !lists.ticketTypes.includes(type) ? [...lists.ticketTypes, type] : lists.ticketTypes;
  // Tableau du ticket : celui du sprint choisi ; les sprints proposés sont ceux du tableau.
  const boardId = f.boardId || myBoard;
  const open = allOpen.filter((s) => s.boardId === boardId);
  const sprintGone = f.sprintId !== null && !allOpen.some((s) => s.id === f.sprintId);
  function chooseBoard(id: string) {
    setF((x) => ({ ...x, boardId: id, sprintId: allOpen.some((s) => s.id === x.sprintId && s.boardId === id) ? x.sprintId : null }));
  }

  return (
    <ItemModal
      title={ticket ? `Ticket ${ticketKey(ticket)}` : 'Nouveau ticket'}
      onClose={onClose}
      onSave={save}
      wide
      canSave={!!f.title.trim() && (external ? !!f.assignee.trim() : true) && !Number.isNaN(parseHours(f.estimatedHours)) && !Number.isNaN(parseHours(f.spentHours))}
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
      {typeChoices.length > 0 && (
        <div className="field span-2">
          <span>Type <span className="muted">(facultatif ; un second clic le retire)</span></span>
          <div className="seg seg-wrap" role="group" aria-label="Type de ticket">
            {typeChoices.map((t) => (
              <button key={t} type="button" className={t === type ? 'on' : undefined} aria-pressed={t === type} onClick={() => chooseType(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}
      <label className="field span-2">
        <span>Intitulé *</span>
        <input
          ref={titleRef}
          className="input"
          autoFocus
          value={f.title}
          onChange={(e) => {
            setTitleTouched(true);
            set('title', e.target.value);
          }}
        />
      </label>
      <label className="field">
        <span>Projet</span>
        <select className="input" value={f.projectId} onChange={(e) => set('projectId', e.target.value)}>
          <option value="">Aucun projet</option>
          {ticket && ticket.projectId !== NO_PROJECT_ID && !activeProjects.some((p) => p.id === ticket.projectId) && <option value={ticket.projectId}>{ticket.projectName}</option>}
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {moved && <span className="muted small">Le ticket sera déplacé ; il garde son numéro et son historique.</span>}
      </label>
      <label className="field">
        <span>Statut</span>
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as TicketStatus)}>
          <StatusOptions list="ticket" current={f.status} />
        </select>
      </label>
      {boards && boards.length > 1 && (
        <label className="field">
          <span>Tableau</span>
          <select className="input" value={boardId} onChange={(e) => chooseBoard(e.target.value)}>
            {!boards.some((b) => b.id === boardId) && <option value={boardId}>Tableau supprimé</option>}
            {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
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
      <label className="field">
        <span>Temps estimé</span>
        <HoursInput label="Temps estimé (heures)" value={f.estimatedHours} onChange={(v) => set('estimatedHours', v)} />
      </label>
      <label className="field">
        <span>Temps passé</span>
        <HoursInput label="Temps passé (heures)" value={f.spentHours} onChange={(v) => set('spentHours', v)} />
        {ticket?.tmaHours != null && (
          <span className="muted small" title="Reporté des relevés TMA importés pour le ticket Desk de ce ticket">
            dont {fmtHours(ticket.tmaHours)} du prestataire (relevés TMA)
          </span>
        )}
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
        <MarkdownField value={f.details} onChange={(v) => set('details', v)} placeholder="Contexte, critères d’acceptation, liens… (collez des captures d’écran directement)" resetKey={ticket?.id ?? 'nouveau'} images />
      </div>
      {ticket && <TicketNotes ticket={ticket} draft={noteDraft} onDraft={setNoteDraft} onChanged={onSaved} />}
    </ItemModal>
  );
}

/**
 * Notes de suivi d'un ticket : un fil de remarques datées (avancement, échanges avec le prestataire…), visible de
 * toute l'équipe. Une note s'enregistre aussitôt, sans toucher au ticket ; chacun modifie ou supprime les siennes.
 */
function TicketNotes({ ticket, draft: text, onDraft: setText, onChanged }: { ticket: TicketRow; draft: string; onDraft: (v: string) => void; onChanged: () => Promise<void> | void }) {
  const { me } = useAuth();
  const { name } = useUsers();
  const [list, setList] = useState<TicketComment[]>(ticket.comments ?? []);
  // Note en cours de modification.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  async function run(action: () => Promise<TicketComment[]>, done?: () => void) {
    setBusy(true);
    try {
      setList(await action());
      done?.();
      void onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(
      () => api.addTicketNote(ticket.projectId, ticket.id, text),
      () => {
        setText('');
        setResetKey((k) => k + 1);
      },
    );

  return (
    <div className="field span-2 ticket-notes">
      <span>Notes de suivi{list.length > 0 && <span className="muted"> ({list.length})</span>}</span>
      {list.length > 0 && (
        <ul className="ticket-note-list">
          {list.map((n) => (
            <li key={n.id}>
              <div className="ticket-note-head small">
                <strong>{name(n.by) === n.by ? n.author || shortUser(n.by) : name(n.by)}</strong>
                <span className="muted">
                  {formatDate(n.at.slice(0, 10))} à {n.at.slice(11, 16).replace(':', 'h')}
                  {n.editedAt && ' · modifiée'}
                </span>
                {n.by === me.email && editing?.id !== n.id && (
                  <span className="ticket-note-actions">
                    <button type="button" className="btn-link small" disabled={busy} onClick={() => setEditing({ id: n.id, text: n.text })}>Modifier</button>
                    <button
                      type="button"
                      className="btn-link small"
                      disabled={busy}
                      onClick={() => confirm('Supprimer cette note ?') && void run(() => api.deleteTicketNote(ticket.projectId, ticket.id, n.id))}
                    >
                      Supprimer
                    </button>
                  </span>
                )}
              </div>
              {editing?.id === n.id ? (
                <div className="ticket-note-edit">
                  <MarkdownField value={editing.text} onChange={(v) => setEditing({ id: n.id, text: v })} resetKey={`note-${n.id}`} />
                  <div className="actions">
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(null)}>Annuler</button>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busy || !editing.text.trim()}
                      onClick={() => void run(() => api.updateTicketNote(ticket.projectId, ticket.id, n.id, editing.text), () => setEditing(null))}
                    >
                      Enregistrer
                    </button>
                  </div>
                </div>
              ) : (
                <MarkdownView markdown={n.text} />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="ticket-note-new">
        <MarkdownField value={text} onChange={setText} placeholder="Ajouter une note : avancement, échange avec le prestataire, point de vigilance…" resetKey={`nouvelle-${resetKey}`} />
        <div className="actions">
          <button type="button" className="btn btn-sm" disabled={busy || !text.trim()} onClick={() => void add()}>Ajouter la note</button>
        </div>
      </div>
    </div>
  );
}
