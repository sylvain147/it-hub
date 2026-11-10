import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  byIdeaPriority,
  CLOSED_IDEA_STATUSES,
  DEFAULT_IDEA_DOMAIN,
  IDEA_STATUSES,
  IDEA_STATUS_LABELS,
  NO_PROJECT_ID,
  PRIORITIES,
  PRIORITY_LABELS,
  ticketKey,
  type Idea,
  type IdeaStatus,
  type Priority,
} from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDate, toast } from '../components/ui';
import { DataList, ItemModal, MarkdownField, MarkdownView } from '../projects/common';
import { ProjectSelect, useProjectRefs, type ProjectRef } from '../tasks/tasks';
import { useUsers } from '../users/context';

type StatusFilter = IdeaStatus | 'actives' | 'toutes';

async function attempt<T>(fn: () => Promise<T>, done?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (done) toast(done);
    return r;
  } catch (e) {
    toast((e as Error).message, 'error');
    return null;
  }
}

/**
 * Idées d'amélioration de l'équipe (ERP, outils…) : liste classée par priorité puis par nombre de soutiens,
 * saisie rapide, et création d'un ticket à partir d'une idée retenue.
 */
export function IdeasPage() {
  const { email } = useAuth();
  const { name } = useUsers();
  const { data, setData, error, loading, reload } = useLoad(() => api.ideas(), []);
  const projects = useProjectRefs();
  const [domain, setDomain] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('actives');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Idea | 'new' | null>(null);
  const [ticketFor, setTicketFor] = useState<Idea | null>(null);
  const [quick, setQuick] = useState({ title: '', priority: 'normale' as Priority });

  const domains = useMemo(() => [...new Set([DEFAULT_IDEA_DOMAIN, ...(data ?? []).map((i) => i.domain).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'fr')), [data]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? [])
      .filter((i) => {
        if (domain && i.domain !== domain) return false;
        if (status === 'actives' && CLOSED_IDEA_STATUSES.includes(i.status)) return false;
        if (status !== 'actives' && status !== 'toutes' && i.status !== status) return false;
        return !needle || [i.title, i.details, i.domain].some((s) => s.toLowerCase().includes(needle));
      })
      .sort(byIdeaPriority);
  }, [data, domain, status, q]);
  const counts = useMemo(() => Object.fromEntries(PRIORITIES.map((p) => [p, rows.filter((i) => i.priority === p).length])) as Record<Priority, number>, [rows]);

  const replace = (i: Idea) => setData((d) => d && d.map((x) => (x.id === i.id ? i : x)));
  const patch = async (i: Idea, b: Partial<Idea>) => {
    const out = await attempt(() => api.updateIdea(i.id, b));
    if (out) replace(out);
  };

  async function quickAdd() {
    if (!quick.title.trim()) return;
    const out = await attempt(() => api.createIdea({ title: quick.title, priority: quick.priority, domain: domain || DEFAULT_IDEA_DOMAIN }));
    if (out) {
      setData((d) => [...(d ?? []), out]);
      setQuick((x) => ({ ...x, title: '' }));
    }
  }

  const projectName = (id: string) => (id === NO_PROJECT_ID ? 'Hors projet' : (projects.find((p) => p.id === id)?.name ?? ''));

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>💡 Idées d’amélioration</h1>
          <p className="muted">
            Les idées de l’équipe, classées par priorité puis par nombre de soutiens (👍). Quand une idée est retenue, « → Ticket » la place dans le backlog d’un projet.
          </p>
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nouvelle idée</button>
        </div>
      </div>

      <div className="filters">
        <select className="input input-auto" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domaine">
          <option value="">Tous les domaines</option>
          {domains.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input input-auto" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Statut">
          <option value="actives">À traiter (hors réalisées et écartées)</option>
          <option value="toutes">Toutes</option>
          {IDEA_STATUSES.map((s) => <option key={s} value={s}>{IDEA_STATUS_LABELS[s]}</option>)}
        </select>
        <input className="input" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="toolbar-row idea-quick">
        <input
          className="input quick-add"
          value={quick.title}
          onChange={(e) => setQuick((x) => ({ ...x, title: e.target.value }))}
          onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
          placeholder={`Nouvelle idée${domain ? ` (${domain})` : ''}, puis Entrée`}
        />
        <select className="input input-auto" value={quick.priority} onChange={(e) => setQuick((x) => ({ ...x, priority: e.target.value as Priority }))} aria-label="Priorité">
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
        <button className="btn" disabled={!quick.title.trim()} onClick={() => void quickAdd()}>Ajouter</button>
      </div>

      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState>
          {data?.length ? (
            'Aucune idée ne correspond aux filtres.'
          ) : (
            'Aucune idée pour l’instant.'
          )}
        </EmptyState>
      ) : (
        <>
          <p className="muted small">
            {rows.length} idée{rows.length > 1 ? 's' : ''} ·{' '}
            {[...PRIORITIES].reverse().filter((p) => counts[p]).map((p) => `${counts[p]} ${PRIORITY_LABELS[p].toLowerCase()}`).join(' · ')}
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Priorité</th>
                  <th>Idée</th>
                  <th>Statut</th>
                  <th className="num">Soutiens</th>
                  <th>Ticket</th>
                  <th>Proposée</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const voted = i.votes.includes(email);
                  return (
                    <tr key={i.id} className={CLOSED_IDEA_STATUSES.includes(i.status) ? 'row-muted' : undefined}>
                      <td>
                        <select className={`input input-sm input-auto prio-${i.priority}`} value={i.priority} onChange={(e) => void patch(i, { priority: e.target.value as Priority })} aria-label="Priorité">
                          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                        </select>
                      </td>
                      <td>
                        <button className="btn-link strong" onClick={() => setEditing(i)}>{i.title}</button>
                        <div className="muted small">{[i.domain, projectName(i.projectId)].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>
                        <select className="input input-sm input-auto" value={i.status} onChange={(e) => void patch(i, { status: e.target.value as IdeaStatus })} aria-label="Statut">
                          {IDEA_STATUSES.map((s) => <option key={s} value={s}>{IDEA_STATUS_LABELS[s]}</option>)}
                        </select>
                      </td>
                      <td className="num">
                        <button
                          className={`btn btn-sm${voted ? ' btn-following' : ''}`}
                          title={i.votes.length ? `Soutenue par ${i.votes.map(name).join(', ')}` : 'Soutenir cette idée'}
                          aria-pressed={voted}
                          onClick={async () => {
                            const out = await attempt(() => api.voteIdea(i.id, !voted));
                            if (out) replace(out);
                          }}
                        >
                          👍 {i.votes.length}
                        </button>
                      </td>
                      <td>
                        {i.ticket ? (
                          <Link to={i.ticket.projectId === NO_PROJECT_ID ? '/sprints' : `/projets/${i.ticket.projectId}?onglet=tickets`}>{ticketKey(i.ticket)}</Link>
                        ) : CLOSED_IDEA_STATUSES.includes(i.status) ? (
                          <span className="muted">—</span>
                        ) : (
                          <button className="btn btn-sm btn-ghost" onClick={() => setTicketFor(i)}>→ Ticket</button>
                        )}
                      </td>
                      <td className="small">{formatDate(i.createdAt.slice(0, 10))}<div className="muted">{name(i.createdBy)}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <IdeaModal
          idea={editing === 'new' ? null : editing}
          defaultDomain={domain || DEFAULT_IDEA_DOMAIN}
          domains={domains}
          projects={projects}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
      {ticketFor && <TicketDialog idea={ticketFor} projects={projects} onClose={() => setTicketFor(null)} onDone={replace} />}
    </div>
  );
}

function IdeaModal({
  idea,
  defaultDomain,
  domains,
  projects,
  onClose,
  onSaved,
}: {
  idea: Idea | null;
  defaultDomain: string;
  domains: string[];
  projects: ProjectRef[];
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const { name } = useUsers();
  const [f, setF] = useState({
    title: idea?.title ?? '',
    details: idea?.details ?? '',
    priority: idea?.priority ?? ('normale' as Priority),
    status: idea?.status ?? ('nouvelle' as IdeaStatus),
    domain: idea?.domain ?? defaultDomain,
    projectId: idea?.projectId ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    if (idea) await api.updateIdea(idea.id, f);
    else await api.createIdea(f);
    await onSaved();
  }
  async function remove() {
    if (!idea || !confirm(`Supprimer l’idée « ${idea.title} » ?`)) return;
    if (await attempt(() => api.deleteIdea(idea.id), 'Idée supprimée.')) {
      onClose();
      await onSaved();
    }
  }

  return (
    <ItemModal
      title={idea ? 'Idée d’amélioration' : 'Nouvelle idée'}
      onClose={onClose}
      onSave={save}
      canSave={!!f.title.trim()}
      wide
      extraFooter={idea && <button className="btn btn-danger-ghost" onClick={remove}>Supprimer</button>}
    >
      <label className="field span-2">
        <span>Idée *</span>
        <input className="input input-title" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} />
      </label>
      <label className="field">
        <span>Priorité</span>
        <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Statut</span>
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as IdeaStatus)}>
          {IDEA_STATUSES.map((s) => <option key={s} value={s}>{IDEA_STATUS_LABELS[s]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Domaine</span>
        <input className="input" list="idea-domains" value={f.domain} onChange={(e) => set('domain', e.target.value)} placeholder="ex. ERP" />
        <DataList id="idea-domains" values={domains} />
      </label>
      <label className="field">
        <span>Projet concerné</span>
        <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} projects={projects} emptyLabel="Aucun" />
      </label>
      <div className="field span-2">
        <span>Description</span>
        <MarkdownField value={f.details} onChange={(v) => set('details', v)} placeholder="Le besoin, le gain attendu, les écrans concernés…" resetKey={idea?.id ?? 'nouvelle'} />
      </div>
      {idea && (
        <p className="muted small span-2">
          Proposée le {formatDate(idea.createdAt.slice(0, 10))} par {name(idea.createdBy)}
          {idea.votes.length > 0 && <> · soutenue par {idea.votes.map(name).join(', ')}</>}
          {idea.ticket && <> · ticket {ticketKey(idea.ticket)}</>}
        </p>
      )}
    </ItemModal>
  );
}

/** Création d'un ticket à partir d'une idée : dans le projet de l'idée, un autre, ou hors projet. */
function TicketDialog({ idea, projects, onClose, onDone }: { idea: Idea; projects: ProjectRef[]; onClose: () => void; onDone: (i: Idea) => void }) {
  const [projectId, setProjectId] = useState(idea.projectId);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    const out = await attempt(() => api.ideaTicket(idea.id, projectId || NO_PROJECT_ID));
    setBusy(false);
    if (!out) return;
    toast(`Ticket ${ticketKey(out.ticket!)} créé dans le backlog.`);
    onDone(out);
    onClose();
  }
  return (
    <Modal
      title="Créer un ticket à partir de l’idée"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy} onClick={create}>{busy && <Spinner small />} Créer le ticket</button>
        </>
      }
    >
      <p><strong>{idea.title}</strong> <span className="muted small">({PRIORITY_LABELS[idea.priority]})</span></p>
      {idea.details && <MarkdownView markdown={idea.details} className="small" />}
      <label className="field mt">
        <span>Projet du ticket</span>
        <ProjectSelect value={projectId} onChange={setProjectId} projects={projects} emptyLabel="Aucun projet" />
      </label>
      <p className="muted small">Le ticket arrive dans le backlog des sprints, avec la priorité de l’idée ; l’idée passe « En cours ».</p>
    </Modal>
  );
}
