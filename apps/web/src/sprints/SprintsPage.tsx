import { useState } from 'react';
import { Link } from 'react-router';
import { cardColor, describeCardRule, initials, isCardRuleComplete, shortDay, ticketKey, TICKET_STATUSES, type Sprint, type SprintListItem, type SprintsOverview, type TicketStatus, type TicketView } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useUsers } from '../users/context';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, toast } from '../components/ui';
import { DueLabel, ItemModal } from '../projects/common';
import { useSettings } from '../settings/context';
import { Swatch } from './charts';
import { sprintLabel, TicketLine, TicketModal, type TicketRow } from './tickets';

const STATE_BADGES: Record<Sprint['state'], string> = { future: 'badge', active: 'badge badge-warn', closed: 'badge badge-ok' };
const STATE_LABELS: Record<Sprint['state'], string> = { future: 'À venir', active: 'En cours', closed: 'Clos' };

export function SprintStateBadge({ state }: { state: Sprint['state'] }) {
  return <span className={STATE_BADGES[state]}>{STATE_LABELS[state]}</span>;
}

export function sprintDates(s: Pick<Sprint, 'startDate' | 'endDate'>) {
  if (!s.startDate && !s.endDate) return 'dates à fixer';
  return `du ${shortDay(s.startDate) || '?'} au ${shortDay(s.endDate) || '?'}`;
}

async function attempt(fn: () => Promise<unknown>, done?: string) {
  try {
    await fn();
    if (done) toast(done);
  } catch (e) {
    toast((e as Error).message, 'error');
  }
}

/** Sprints : tableau du sprint en cours, planification des sprints à venir depuis le backlog, sprints clos. */
export function SprintsPage() {
  const data = useLoad(() => api.sprints(), []);
  const [editing, setEditing] = useState<{ ticket: TicketRow | null; sprintId?: number | null; status?: TicketStatus } | null>(null);
  const [sprintForm, setSprintForm] = useState<Sprint | 'new' | null>(null);
  const [closing, setClosing] = useState<SprintListItem | null>(null);
  const o = data.data;
  const reload = async () => {
    await data.reload();
  };

  const active = o?.sprints.find((s) => s.state === 'active');
  const future = o?.sprints.filter((s) => s.state === 'future') ?? [];
  const closed = o?.sprints.filter((s) => s.state === 'closed') ?? [];
  const open = o ? o.sprints.filter((s) => s.state !== 'closed') : [];
  const open_ = (t: TicketRow) => setEditing({ ticket: t });

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Sprints</h1>
          <p className="muted small">
            Les tickets des projets se planifient dans les sprints depuis le backlog, puis avancent sur le tableau du sprint en cours. L’assistant rédige à la demande la
            préparation ou le compte rendu d’un sprint.
          </p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => setSprintForm('new')}>+ Nouveau sprint</button>
          <button className="btn btn-primary" onClick={() => setEditing({ ticket: null, sprintId: null })}>+ Nouveau ticket</button>
        </div>
      </div>
      <ErrorBox error={data.error} />
      {!o && !data.error && <Spinner />}
      {o && (
        <>
          {active ? (
            <ActiveSprint o={o} sprint={active} onOpen={open_} onAdd={(status) => setEditing({ ticket: null, sprintId: active.id, status })} onChanged={reload} onEdit={() => setSprintForm(active)} onClose={() => setClosing(active)} />
          ) : (
            <section className="card">
              <h2>Aucun sprint en cours</h2>
              <p className="muted small">
                {future.length ? 'Démarrez le prochain sprint quand ses tickets sont planifiés.' : 'Créez un sprint, planifiez-y des tickets du backlog, puis démarrez-le.'}
              </p>
            </section>
          )}

          <h2 className="page-section">Planification</h2>
          <div className="planning">
            {future.map((s) => (
              <PlannedSprint
                key={s.id}
                o={o}
                sprint={s}
                open={open}
                canStart={!active && s.id === future[0]!.id}
                onOpen={open_}
                onAdd={() => setEditing({ ticket: null, sprintId: s.id })}
                onEdit={() => setSprintForm(s)}
                onChanged={reload}
              />
            ))}
            <Backlog o={o} open={open} onOpen={open_} onAdd={() => setEditing({ ticket: null, sprintId: null })} onChanged={reload} />
          </div>

          {closed.length > 0 && (
            <section className="card">
              <h2>Sprints clos</h2>
              <ul className="list-plain">
                {closed.map((s) => (
                  <li key={s.id} className="sprint-row">
                    <Link to={`/sprints/${s.id}`} className="strong-link">{s.name}</Link>
                    <span className="muted small">{sprintDates(s)} · {s.ticketCount} ticket{s.ticketCount > 1 ? 's' : ''}</span>
                    {s.hasCompteRendu && <span className="badge badge-ok">Compte rendu</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {editing && (
        <TicketModal ticket={editing.ticket} defaults={{ sprintId: editing.sprintId, status: editing.status }} sprints={open} onClose={() => setEditing(null)} onSaved={reload} />
      )}
      {sprintForm && <SprintFormModal sprint={sprintForm === 'new' ? null : sprintForm} onClose={() => setSprintForm(null)} onSaved={reload} />}
      {closing && <CloseSprintModal sprint={closing} future={future} onClose={() => setClosing(null)} onClosed={reload} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sprint en cours : tableau par statut
// ---------------------------------------------------------------------------

function ActiveSprint({
  o,
  sprint,
  onOpen,
  onAdd,
  onChanged,
  onEdit,
  onClose,
}: {
  o: SprintsOverview;
  sprint: SprintListItem;
  onOpen: (t: TicketRow) => void;
  onAdd: (status: TicketStatus) => void;
  onChanged: () => Promise<void>;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { email } = useAuth();
  const { options, label, lists } = useSettings();
  const { name } = useUsers();
  const today = new Date().toISOString().slice(0, 10);
  const rules = lists.cardRules.filter(isCardRuleComplete);
  const [mine, setMine] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TicketStatus | null>(null);
  const all = o.tickets.filter((t) => t.sprintId === sprint.id);
  const tickets = all.filter((t) => (!mine || t.assigneeId === email) && (!projectId || t.projectId === projectId));
  // Colonnes : statuts visibles du paramétrage, plus ceux masqués qui ont encore des tickets.
  const columns = [...options('ticket').map((s) => s.key as TicketStatus), ...TICKET_STATUSES.filter((s) => !options('ticket').some((x) => x.key === s) && tickets.some((t) => t.status === s))];
  const projects = [...new Map(all.map((t) => [t.projectId, t.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  const done = all.filter((t) => t.done).length;

  async function move(t: TicketView, status: TicketStatus) {
    if (t.status === status) return;
    await attempt(async () => {
      await api.updateItem(t.projectId, 'tasks', t.id, { status });
      await onChanged();
    });
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{sprint.name} <SprintStateBadge state="active" /></h2>
          <div className="muted small">
            {sprintDates(sprint)} · {done} ticket{done > 1 ? 's' : ''} terminé{done > 1 ? 's' : ''} sur {all.length}
          </div>
          {sprint.goal && <div className="small mt-xs">🎯 {sprint.goal}</div>}
        </div>
        <div className="row-actions">
          <Link to={`/sprints/${sprint.id}`} className="btn btn-sm">Revue et documents</Link>
          <button className="btn btn-sm btn-ghost" onClick={onEdit}>Modifier</button>
          <button className="btn btn-sm" onClick={onClose}>Clôturer le sprint</button>
        </div>
      </div>
      <div className="toolbar-row">
        <select className="input input-auto" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet">
          <option value="">Tous les projets</option>
          {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Seulement les miens
        </label>
      </div>
      {rules.length > 0 && all.length > 0 && (
        <div className="viz-legend card-legend" title="Paramétrage → Tableau des sprints">
          {rules.map((r, i) => (
            <span key={i} className="viz-legend-item">
              <span className={`sw card-bg-${r.color}`} aria-hidden /> {describeCardRule(r, { project: (id) => projects.find(([x]) => x === id)?.[1] ?? 'projet sans ticket ici', user: name })}
            </span>
          ))}
          <Link to="/parametrage?onglet=tableau" className="small">Couleurs…</Link>
        </div>
      )}
      {!all.length ? (
        <EmptyState>Aucun ticket dans ce sprint. Planifiez-en depuis le backlog ci-dessous.</EmptyState>
      ) : (
        <div className="board" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(180px, 1fr))` }}>
          {columns.map((status) => {
            const col = tickets.filter((t) => t.status === status);
            return (
              <div
                key={status}
                className={over === status ? 'board-col over' : 'board-col'}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  setOver(status);
                }}
                onDragLeave={() => setOver((s) => (s === status ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const t = tickets.find((x) => x.id === dragging);
                  setDragging(null);
                  if (t) void move(t, status);
                }}
              >
                <div className="board-col-head">
                  <Swatch group={status} /> {label('ticket', status)} <span className="muted">{col.length}</span>
                  <button className="btn-icon" title="Ajouter un ticket dans cette colonne" onClick={() => onAdd(status)}>＋</button>
                </div>
                {col.map((t) => {
                  const bg = cardColor(rules, t, today);
                  return (
                  <div
                    key={t.id}
                    className={`board-card${bg ? ` card-bg-${bg}` : ''}${dragging === t.id ? ' dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(t.id);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                  >
                    <button className="board-card-title" onClick={() => onOpen(t)}>{t.title}</button>
                    <div className="board-card-meta">
                      <span className="ticket-key">{ticketKey(t)}</span>
                      <span className="small muted board-card-project">{t.projectName}</span>
                      {t.dueDate && <span className="small"><DueLabel date={t.dueDate} done={t.done} /></span>}
                      {t.assignee && <span className={t.assigneeId ? 'avatar' : 'avatar avatar-ext'} title={t.assignee}>{initials(t.assignee)}</span>}
                    </div>
                    {/* Écrans tactiles : pas de glisser-déposer, on change le statut ici. */}
                    <select className="input input-sm board-card-move" value={t.status} onChange={(e) => void move(t, e.target.value as TicketStatus)} aria-label="Statut">
                      {columns.map((s) => <option key={s} value={s}>{label('ticket', s)}</option>)}
                    </select>
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Planification : sprints à venir et backlog
// ---------------------------------------------------------------------------

/** Choix du sprint d'un ticket (ou backlog), directement dans la liste. */
function PlanSelect({ t, open, onChanged }: { t: TicketView; open: Sprint[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <select
      className="input input-sm input-auto"
      value={t.sprintId ?? ''}
      disabled={busy}
      aria-label={`Sprint de ${ticketKey(t)}`}
      onChange={(e) => {
        const sprintId = e.target.value ? Number(e.target.value) : null;
        setBusy(true);
        void attempt(async () => {
          await api.updateItem(t.projectId, 'tasks', t.id, { sprintId });
          await onChanged();
        }).finally(() => setBusy(false));
      }}
    >
      <option value="">Backlog</option>
      {open.map((s) => <option key={s.id} value={s.id}>{sprintLabel(s)}</option>)}
    </select>
  );
}

function PlannedSprint({
  o,
  sprint,
  open,
  canStart,
  onOpen,
  onAdd,
  onEdit,
  onChanged,
}: {
  o: SprintsOverview;
  sprint: SprintListItem;
  open: Sprint[];
  canStart: boolean;
  onOpen: (t: TicketRow) => void;
  onAdd: () => void;
  onEdit: () => void;
  onChanged: () => Promise<void>;
}) {
  const tickets = o.tickets.filter((t) => t.sprintId === sprint.id);
  const [busy, setBusy] = useState(false);
  async function start() {
    if (!confirm(`Démarrer « ${sprint.name} » avec ${tickets.length} ticket${tickets.length > 1 ? 's' : ''} ?`)) return;
    setBusy(true);
    await attempt(async () => {
      await api.startSprint(sprint.id);
      await onChanged();
    }, `${sprint.name} démarré.`);
    setBusy(false);
  }
  async function remove() {
    if (!confirm(`Supprimer « ${sprint.name} » ? Ses ${tickets.length} ticket(s) reviendront au backlog.`)) return;
    await attempt(async () => {
      await api.deleteSprint(sprint.id);
      await onChanged();
    }, 'Sprint supprimé.');
  }
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{sprint.name} <SprintStateBadge state="future" /></h2>
          <div className="muted small">{sprintDates(sprint)} · {tickets.length} ticket{tickets.length > 1 ? 's' : ''}</div>
          {sprint.goal && <div className="small mt-xs">🎯 {sprint.goal}</div>}
        </div>
        <div className="row-actions">
          <Link to={`/sprints/${sprint.id}`} className="btn btn-sm">Préparation</Link>
          <button className="btn btn-sm btn-ghost" onClick={onEdit}>Modifier</button>
          <button className="btn btn-sm btn-ghost" onClick={() => void remove()}>Supprimer</button>
          {canStart && <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void start()}>{busy && <Spinner small />} Démarrer</button>}
        </div>
      </div>
      {tickets.length ? (
        <ul className="ticket-list">
          {tickets.map((t) => <TicketLine key={t.id} t={t} onOpen={onOpen} showProject extra={<PlanSelect t={t} open={open} onChanged={onChanged} />} />)}
        </ul>
      ) : (
        <p className="muted small">Aucun ticket : planifiez-en depuis le backlog.</p>
      )}
      <button className="btn-link small mt-xs" onClick={onAdd}>+ Ticket dans ce sprint</button>
    </section>
  );
}

function Backlog({ o, open, onOpen, onAdd, onChanged }: { o: SprintsOverview; open: Sprint[]; onOpen: (t: TicketRow) => void; onAdd: () => void; onChanged: () => Promise<void> }) {
  const [projectId, setProjectId] = useState('');
  const all = o.tickets.filter((t) => t.sprintId === null && !t.done);
  const tickets = all.filter((t) => !projectId || t.projectId === projectId);
  const projects = [...new Map(all.map((t) => [t.projectId, t.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr'));
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Backlog</h2>
          <div className="muted small">{all.length} ticket{all.length > 1 ? 's' : ''} ouvert{all.length > 1 ? 's' : ''} hors sprint, tous projets confondus</div>
        </div>
        <div className="row-actions">
          {projects.length > 1 && (
            <select className="input input-sm input-auto" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet">
              <option value="">Tous les projets</option>
              {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <button className="btn btn-sm" onClick={onAdd}>+ Ticket</button>
        </div>
      </div>
      {tickets.length ? (
        <ul className="ticket-list">
          {tickets.map((t) => <TicketLine key={t.id} t={t} onOpen={onOpen} showProject extra={open.length ? <PlanSelect t={t} open={open} onChanged={onChanged} /> : undefined} />)}
        </ul>
      ) : (
        <p className="muted small">Backlog vide. Les tickets se créent ici, depuis l’onglet « Tickets » d’un projet, ou à partir des propositions de l’assistant sur un compte rendu.</p>
      )}
      {!open.length && all.length > 0 && <p className="muted small">Créez un sprint pour y planifier ces tickets.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sprint : création, modification, clôture
// ---------------------------------------------------------------------------

export function SprintFormModal({ sprint, onClose, onSaved }: { sprint: Sprint | null; onClose: () => void; onSaved: () => Promise<void> | void }) {
  const [f, setF] = useState({ name: sprint?.name ?? '', goal: sprint?.goal ?? '', startDate: sprint?.startDate ?? '', endDate: sprint?.endDate ?? '' });
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <ItemModal
      title={sprint ? `Modifier « ${sprint.name} »` : 'Nouveau sprint'}
      onClose={onClose}
      canSave={!!sprint ? !!f.name.trim() : true}
      onSave={async () => {
        if (sprint) await api.updateSprint(sprint.id, f);
        else await api.createSprint(f);
        await onSaved();
      }}
    >
      <label className="field span-2">
        <span>Nom</span>
        <input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={sprint ? '' : 'Par défaut : « Sprint N »'} />
      </label>
      <label className="field">
        <span>Début</span>
        <input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
      </label>
      <label className="field">
        <span>Fin</span>
        <input className="input" type="date" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} />
      </label>
      <label className="field span-2">
        <span>Objectif</span>
        <textarea className="input" rows={2} value={f.goal} onChange={(e) => set('goal', e.target.value)} placeholder="Ce que le sprint doit livrer" />
      </label>
      {!sprint && <p className="muted small span-2">Sans dates, le sprint dure deux semaines à la suite du dernier sprint prévu.</p>}
    </ItemModal>
  );
}

function CloseSprintModal({ sprint, future, onClose, onClosed }: { sprint: SprintListItem; future: SprintListItem[]; onClose: () => void; onClosed: () => Promise<void> }) {
  const [moveTo, setMoveTo] = useState<number | null>(future[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  async function close() {
    setBusy(true);
    await attempt(async () => {
      const res = await api.closeSprint(sprint.id, moveTo);
      await onClosed();
      onClose();
      toast(`${sprint.name} clôturé${res.moved ? ` : ${res.moved} ticket${res.moved > 1 ? 's' : ''} déplacé${res.moved > 1 ? 's' : ''}` : ''}.`);
    });
    setBusy(false);
  }
  return (
    <Modal
      title={`Clôturer « ${sprint.name} »`}
      onClose={onClose}
      footer={
        <>
          <span className="tb-flex" />
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void close()}>{busy && <Spinner small />} Clôturer</button>
        </>
      }
    >
      <p>
        {sprint.openCount
          ? `${sprint.openCount} ticket${sprint.openCount > 1 ? 's' : ''} non terminé${sprint.openCount > 1 ? 's' : ''} sur ${sprint.ticketCount}. Où les envoyer ?`
          : `Les ${sprint.ticketCount} tickets sont terminés.`}
      </p>
      {sprint.openCount > 0 && (
        <select className="input" value={moveTo ?? ''} onChange={(e) => setMoveTo(e.target.value ? Number(e.target.value) : null)}>
          {future.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="">Backlog</option>
        </select>
      )}
      <p className="muted small mt">Les chiffres du sprint sont figés à la clôture : vous pourrez ensuite faire rédiger son compte rendu.</p>
    </Modal>
  );
}
