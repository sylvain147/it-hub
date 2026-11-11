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
type Sort = 'priorite' | 'soutiens' | 'recentes';

/** Onglets de statut : les idées à traiter d'abord, puis chaque statut, puis toutes. */
const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: 'actives', label: 'À traiter' },
  ...IDEA_STATUSES.map((s) => ({ id: s as StatusFilter, label: IDEA_STATUS_LABELS[s] })),
  { id: 'toutes', label: 'Toutes' },
];

const SORTS: Record<Sort, { label: string; fn: (a: Idea, b: Idea) => number }> = {
  priorite: { label: 'Priorité', fn: byIdeaPriority },
  soutiens: { label: 'Les plus soutenues', fn: (a, b) => b.votes.length - a.votes.length || byIdeaPriority(a, b) },
  recentes: { label: 'Les plus récentes', fn: (a, b) => b.createdAt.localeCompare(a.createdAt) },
};

const matchStatus = (i: Idea, status: StatusFilter) =>
  status === 'toutes' || (status === 'actives' ? !CLOSED_IDEA_STATUSES.includes(i.status) : i.status === status);

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
 * Idées d'amélioration de l'équipe (ERP, outils…) : des cartes avec leurs soutiens (👍), rangées par statut
 * (onglets avec leur nombre), filtrées par domaine, triées par priorité, soutiens ou date ; saisie rapide ;
 * une idée nouvelle se retient ou s'écarte d'un clic, et une idée retenue devient un ticket.
 */
export function IdeasPage() {
  const { email } = useAuth();
  const { name } = useUsers();
  const { data, setData, error, loading, reload } = useLoad(() => api.ideas(), []);
  const projects = useProjectRefs();
  const [domain, setDomain] = useState<string>('');
  const [status, setStatus] = useState<StatusFilter>('actives');
  const [sort, setSort] = useState<Sort>('priorite');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Idea | 'new' | null>(null);
  const [ticketFor, setTicketFor] = useState<Idea | null>(null);
  const [quick, setQuick] = useState({ title: '', priority: 'normale' as Priority });

  const domains = useMemo(() => [...new Set([DEFAULT_IDEA_DOMAIN, ...(data ?? []).map((i) => i.domain).filter(Boolean)])].sort((a, b) => a.localeCompare(b, 'fr')), [data]);
  // Filtres hors statut : les compteurs des onglets les suivent.
  const base = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter(
      (i) =>
        (!domain || i.domain === domain) &&
        (!mine || i.createdBy === email || i.votes.includes(email)) &&
        (!needle || [i.title, i.details, i.domain].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [data, domain, mine, q, email]);
  const rows = useMemo(() => base.filter((i) => matchStatus(i, status)).sort(SORTS[sort].fn), [base, status, sort]);

  const replace = (i: Idea) => setData((d) => d && d.map((x) => (x.id === i.id ? i : x)));
  const patch = async (i: Idea, b: Partial<Idea>, done?: string) => {
    const out = await attempt(() => api.updateIdea(i.id, b), done);
    if (out) replace(out);
  };
  const vote = async (i: Idea) => {
    const out = await attempt(() => api.voteIdea(i.id, !i.votes.includes(email)));
    if (out) replace(out);
  };

  async function quickAdd() {
    if (!quick.title.trim()) return;
    const out = await attempt(() => api.createIdea({ title: quick.title, priority: quick.priority, domain: domain || DEFAULT_IDEA_DOMAIN }), 'Idée ajoutée.');
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
          <p className="muted">Les idées de l’équipe. Soutenez celles qui vous parlent (👍) ; une idée retenue devient un ticket en un clic.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nouvelle idée détaillée</button>
        </div>
      </div>

      <section className="card idea-quick">
        <div className="idea-quick-row">
          <input
            className="input input-title"
            value={quick.title}
            onChange={(e) => setQuick((x) => ({ ...x, title: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && void quickAdd()}
            placeholder={`💡 Une idée${domain ? ` pour ${domain}` : ''} ? Écrivez-la, puis Entrée`}
          />
          <select className="input input-auto" value={quick.priority} onChange={(e) => setQuick((x) => ({ ...x, priority: e.target.value as Priority }))} aria-label="Priorité">
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
          <button className="btn btn-primary" disabled={!quick.title.trim()} onClick={() => void quickAdd()}>Ajouter</button>
        </div>
      </section>

      <div className="tabs idea-tabs">
        {STATUS_TABS.map((t) => {
          const n = base.filter((i) => matchStatus(i, t.id)).length;
          return (
            <button key={t.id} className={status === t.id ? 'tab active' : 'tab'} onClick={() => setStatus(t.id)}>
              {t.label} {n > 0 && <span className="pill pill-muted">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="idea-filters">
        <div className="idea-domains" role="group" aria-label="Domaine">
          <button className={!domain ? 'idea-chip on' : 'idea-chip'} onClick={() => setDomain('')}>Tous les domaines</button>
          {domains.map((d) => (
            <button key={d} className={domain === d ? 'idea-chip on' : 'idea-chip'} onClick={() => setDomain(domain === d ? '' : d)}>{d}</button>
          ))}
        </div>
        <span className="tb-flex" />
        <input className="input input-auto" type="search" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
        <select className="input input-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Tri">
          {(Object.keys(SORTS) as Sort[]).map((k) => <option key={k} value={k}>{SORTS[k].label}</option>)}
        </select>
        <label className="check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Les miennes et celles que je soutiens</label>
      </div>

      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState>{data?.length ? 'Aucune idée ne correspond.' : 'Aucune idée pour l’instant : lancez-vous, la première est souvent la meilleure !'}</EmptyState>
      ) : (
        <ul className="idea-list">
          {rows.map((i) => {
            const voted = i.votes.includes(email);
            const closed = CLOSED_IDEA_STATUSES.includes(i.status);
            return (
              <li key={i.id} className={`idea-card idea-${i.status}${closed ? ' idea-closed' : ''}`}>
                <button
                  className={voted ? 'idea-vote on' : 'idea-vote'}
                  aria-pressed={voted}
                  title={i.votes.length ? `Soutenue par ${i.votes.map(name).join(', ')}${voted ? ' (cliquer pour retirer votre soutien)' : ''}` : 'Soutenir cette idée'}
                  onClick={() => void vote(i)}
                >
                  <span className="idea-vote-icon">👍</span>
                  <strong>{i.votes.length}</strong>
                </button>
                <div className="idea-main">
                  <div className="idea-title-row">
                    <button className="idea-title" onClick={() => setEditing(i)}>{i.title}</button>
                    <span className={`badge idea-status-${i.status}`}>{IDEA_STATUS_LABELS[i.status]}</span>
                  </div>
                  {i.details.trim() && (
                    <div className="idea-details" onClick={() => setEditing(i)}>
                      <MarkdownView markdown={i.details} className="small" />
                    </div>
                  )}
                  <div className="idea-meta small">
                    <select className={`input input-sm input-auto prio-${i.priority}`} value={i.priority} onChange={(e) => void patch(i, { priority: e.target.value as Priority })} aria-label="Priorité" title="Priorité">
                      {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                    </select>
                    {i.domain && <span className="badge badge-domain">{i.domain}</span>}
                    {i.projectId && <span className="badge">📁 {projectName(i.projectId)}</span>}
                    <span className="muted">{name(i.createdBy)} · {formatDate(i.createdAt.slice(0, 10))}</span>
                  </div>
                </div>
                <div className="idea-actions">
                  {i.ticket ? (
                    <Link className="btn btn-sm btn-ghost" to={i.ticket.projectId === NO_PROJECT_ID ? '/sprints' : `/projets/${i.ticket.projectId}?onglet=tickets`}>🎫 {ticketKey(i.ticket)}</Link>
                  ) : (
                    <>
                      {i.status === 'nouvelle' && (
                        <>
                          <button className="btn btn-sm" onClick={() => void patch(i, { status: 'retenue' }, 'Idée retenue.')}>✓ Retenir</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => void patch(i, { status: 'ecartee' }, 'Idée écartée.')}>Écarter</button>
                        </>
                      )}
                      {!closed && <button className="btn btn-sm btn-primary" onClick={() => setTicketFor(i)}>→ Ticket</button>}
                      {closed && <button className="btn btn-sm btn-ghost" onClick={() => void patch(i, { status: 'nouvelle' }, 'Idée rouverte.')}>↩ Rouvrir</button>}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
