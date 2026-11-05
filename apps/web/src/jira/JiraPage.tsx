import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  jiraIssueUrl,
  nameKey,
  shortDay,
  SPRINT_GROUP_LABELS,
  statusGroup,
  type JiraBoard,
  type JiraOverview,
  type JiraSprintListItem,
  type JiraTask,
  type JiraTaskView,
  type ProjectSummary,
} from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDateTime, shortUser, toast } from '../components/ui';
import { Swatch } from './charts';

const STATE_LABELS: Record<JiraSprintListItem['state'], string> = { future: 'À venir', active: 'En cours', closed: 'Clos' };
const STATE_BADGES: Record<JiraSprintListItem['state'], string> = { future: 'badge', active: 'badge badge-warn', closed: 'badge badge-ok' };
const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export function SprintStateBadge({ state }: { state: JiraSprintListItem['state'] }) {
  return <span className={STATE_BADGES[state]}>{STATE_LABELS[state]}</span>;
}

/** Statut Jira d'un ticket, avec la couleur de son groupe (à faire, en cours, en recette, en attente, terminé). */
export function JiraStatus({ t }: { t: Pick<JiraTask, 'status' | 'statusCategory'> }) {
  const g = statusGroup(t.status, t.statusCategory);
  return (
    <span className="status-chip" title={SPRINT_GROUP_LABELS[g]}>
      <Swatch group={g} /> {t.status}
    </span>
  );
}

/** Le ticket est-il assigné à l'utilisateur connecté (e-mail communiqué par Jira, sinon nom) ? */
function isMine(t: JiraTask, me: { email: string; name: string }) {
  return (!!t.assigneeEmail && t.assigneeEmail === me.email) || (!!t.assignee && nameKey(t.assignee) === nameKey(me.name));
}

/** Module Jira : import des tickets et des sprints des tableaux suivis, rattachement aux projets, documents de sprint. */
export function JiraPage() {
  const data = useLoad(() => api.jiraOverview(), []);
  const projects = useLoad(() => api.listProjects(), []);
  const [importing, setImporting] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);

  async function runImport() {
    setImporting(true);
    try {
      const o = await api.importJira();
      data.setData(o);
      toast(`${o.tasks.length} ticket${o.tasks.length > 1 ? 's' : ''} et ${o.sprints.length} sprint${o.sprints.length > 1 ? 's' : ''} importés depuis Jira.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setImporting(false);
    }
  }

  const o = data.data;
  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Jira</h1>
          <p className="muted small">
            Vos tickets et vos sprints Jira, importés en lecture seule : reliez les tickets à vos projets, puis faites rédiger par l’assistant le compte rendu ou la
            préparation d’un sprint.
          </p>
        </div>
        {o?.configured && (
          <div className="actions">
            <button className="btn btn-ghost" onClick={() => setBoardsOpen(true)}>Tableaux suivis{o.boards.length ? ` (${o.boards.length})` : ''}</button>
            {o.boards.length > 0 && (
              <button className="btn btn-primary" disabled={importing} onClick={() => void runImport()}>
                {importing ? <Spinner small /> : '⟳'} Importer depuis Jira
              </button>
            )}
          </div>
        )}
      </div>
      <ErrorBox error={data.error} />
      {!o && !data.error && <Spinner />}
      {o && !o.configured && (
        <EmptyState>
          Jira n’est pas encore connecté au hub. Renseignez le site et le jeton d’API dans <Link to="/parametrage?onglet=jira">Paramétrage → Jira</Link>.
        </EmptyState>
      )}
      {o?.configured && !o.boards.length && <BoardsPicker current={[]} onSaved={(x) => data.setData(x)} />}
      {o?.configured && o.boards.length > 0 && !o.syncedAt && (
        <EmptyState>
          Tableaux suivis : {o.boards.map((b) => b.name).join(', ')}.{' '}
          <button className="btn btn-primary btn-sm" disabled={importing} onClick={() => void runImport()}>
            {importing && <Spinner small />} Importer les tickets et les sprints
          </button>
        </EmptyState>
      )}
      {o?.syncedAt && (
        <>
          <p className="muted small">
            Dernier import le {formatDateTime(o.syncedAt)} par {shortUser(o.syncedBy ?? '')} : {o.tasks.length} tickets ({o.boards.map((b) => b.name).join(', ')}). Les tickets se
            modifient dans Jira ; importez à nouveau pour récupérer leur état.
          </p>
          <SprintsCard o={o} />
          <TasksCard o={o} projects={projects.data ?? []} onLinked={(keys, projectId) => data.setData(withLinks(o, keys, projectId, projects.data ?? []))} />
        </>
      )}
      {boardsOpen && o && (
        <Modal title="Tableaux Jira suivis" onClose={() => setBoardsOpen(false)} wide>
          <BoardsPicker
            current={o.boards.map((b) => b.id)}
            onSaved={(x) => {
              data.setData(x);
              setBoardsOpen(false);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function withLinks(o: JiraOverview, keys: string[], projectId: string | null, projects: ProjectSummary[]): JiraOverview {
  const name = projects.find((p) => p.id === projectId)?.name ?? '';
  return { ...o, tasks: o.tasks.map((t) => (keys.includes(t.key) ? { ...t, projectId, projectName: projectId ? name : '' } : t)) };
}

/** Choix des tableaux Scrum dont les sprints et le backlog sont importés. */
function BoardsPicker({ current, onSaved }: { current: number[]; onSaved: (o: JiraOverview) => void }) {
  const boards = useLoad(() => api.jiraBoards(''), []);
  const [chosen, setChosen] = useState<number[]>(current);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.setJiraBoards(chosen));
      toast('Tableaux suivis enregistrés.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const list = (boards.data ?? []).filter((b: JiraBoard) => !q.trim() || `${b.name} ${b.projectKey}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <section className="card">
      <h2>Tableaux à importer</h2>
      <p className="muted small">
        Choisissez les tableaux Scrum de vos projets Jira : leurs sprints (en cours, à venir et les derniers clos) et leur backlog seront importés.
      </p>
      <ErrorBox error={error ?? boards.error} />
      {boards.loading && !boards.data && <Spinner />}
      {boards.data && (
        <>
          {boards.data.length > 8 && <input className="input input-auto mb" placeholder="Filtrer…" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div className="board-picker">
            {list.map((b) => (
              <label key={b.id} className="check">
                <input
                  type="checkbox"
                  disabled={b.type !== 'scrum'}
                  checked={chosen.includes(b.id)}
                  onChange={(e) => setChosen((xs) => (e.target.checked ? [...xs, b.id] : xs.filter((x) => x !== b.id)))}
                />
                {b.name} <span className="muted small">{b.projectKey && `${b.projectKey} · `}{b.type === 'scrum' ? 'Scrum' : b.type === 'kanban' ? 'Kanban — pas de sprints' : b.type}</span>
              </label>
            ))}
            {!list.length && <p className="muted small">Aucun tableau accessible au compte Jira du hub.</p>}
          </div>
          <div className="actions mt">
            <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => void save()}>{busy && <Spinner small />} Enregistrer</button>
          </div>
        </>
      )}
    </section>
  );
}

function SprintsCard({ o }: { o: JiraOverview }) {
  const [all, setAll] = useState(false);
  const multi = o.boards.length > 1;
  const shown = all ? o.sprints : o.sprints.filter((s, i) => s.state !== 'closed' || o.sprints.slice(0, i).filter((x) => x.state === 'closed' && x.boardId === s.boardId).length < 2);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Sprints</h2>
        {shown.length < o.sprints.length || all ? (
          <button className="btn-link small" onClick={() => setAll(!all)}>{all ? 'Masquer les plus anciens' : `Voir les ${o.sprints.length} sprints importés`}</button>
        ) : null}
      </div>
      {!o.sprints.length ? (
        <p className="muted small">Aucun sprint sur les tableaux suivis.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sprint</th>
                {multi && <th>Tableau</th>}
                <th>État</th>
                <th>Dates</th>
                <th>Tickets</th>
                <th>Documents</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/jira/sprints/${s.id}`} className="strong-link">{s.name}</Link>
                    {s.goal && <div className="muted small">🎯 {s.goal}</div>}
                  </td>
                  {multi && <td className="small">{s.boardName}</td>}
                  <td><SprintStateBadge state={s.state} /></td>
                  <td className="small nowrap">{s.startDate ? `${shortDay(s.startDate.slice(0, 10))} → ${s.endDate ? shortDay((s.completeDate ?? s.endDate).slice(0, 10)) : '?'}` : 'non planifié'}</td>
                  <td className="small nowrap">
                    {s.openCount} ouvert{s.openCount > 1 ? 's' : ''} / {s.issueCount}
                    {s.points > 0 && <span className="muted"> · {fmt(s.points)} SP</span>}
                  </td>
                  <td className="small">
                    {s.hasCompteRendu && <span className="badge badge-ok">Compte rendu</span>} {s.hasPreparation && <span className="badge badge-ok">Préparation</span>}{' '}
                    <Link to={`/jira/sprints/${s.id}`} className="small">{s.state === 'closed' ? 'Revue →' : s.state === 'future' ? 'Préparer →' : 'Ouvrir →'}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Who = 'mine' | 'all';

function TasksCard({ o, projects, onLinked }: { o: JiraOverview; projects: ProjectSummary[]; onLinked: (keys: string[], projectId: string | null) => void }) {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const target = params.get('projet') ?? '';
  const anyMine = o.tasks.some((t) => isMine(t, me));
  const [who, setWho] = useState<Who>(target || !anyMine ? 'all' : 'mine');
  const [sprint, setSprint] = useState('');
  const [project, setProject] = useState(target ? '__none' : '');
  const [withDone, setWithDone] = useState(false);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProject, setBulkProject] = useState(target);
  const [busy, setBusy] = useState(false);

  const sprintName = useMemo(() => new Map(o.sprints.map((s) => [s.id, s.name])), [o.sprints]);
  const activeProjects = projects.filter((p) => !['termine', 'abandonne'].includes(p.status));
  const rows = o.tasks
    .filter((t) => {
      if (who === 'mine' && !isMine(t, me)) return false;
      if (!withDone && t.statusCategory === 'done') return false;
      if (sprint === '__backlog' && t.sprintIds.length) return false;
      if (sprint && sprint !== '__backlog' && !t.sprintIds.includes(Number(sprint))) return false;
      if (project === '__none' && t.projectId) return false;
      if (project && project !== '__none' && t.projectId !== project) return false;
      const s = q.trim().toLowerCase();
      return !s || `${t.key} ${t.summary} ${t.parent} ${t.assignee}`.toLowerCase().includes(s);
    })
    .sort((a, b) => a.key.localeCompare(b.key, 'fr', { numeric: true }));
  const allChecked = rows.length > 0 && rows.every((t) => selected.has(t.key));

  async function link(keys: string[], projectId: string | null) {
    setBusy(true);
    try {
      await api.linkJiraTasks(keys, projectId);
      onLinked(keys, projectId);
      setSelected(new Set());
      const p = projects.find((x) => x.id === projectId);
      toast(projectId ? `${keys.length} ticket${keys.length > 1 ? 's' : ''} relié${keys.length > 1 ? 's' : ''} à « ${p?.name ?? ''} ».` : `${keys.length} ticket${keys.length > 1 ? 's' : ''} détaché${keys.length > 1 ? 's' : ''}.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const sprintLabel = (t: JiraTaskView) => (t.sprintIds.length ? t.sprintIds.map((id) => sprintName.get(id) ?? `Sprint ${id}`).join(', ') : 'Backlog');

  return (
    <section className="card">
      <div className="card-head">
        <h2>Tickets</h2>
        <span className="muted small">{rows.length} affiché{rows.length > 1 ? 's' : ''} sur {o.tasks.length}</span>
      </div>
      <div className="toolbar-row">
        <div className="seg">
          <button className={who === 'mine' ? 'on' : ''} onClick={() => setWho('mine')}>Mes tickets</button>
          <button className={who === 'all' ? 'on' : ''} onClick={() => setWho('all')}>Tous</button>
        </div>
        <select className="input input-auto" value={sprint} onChange={(e) => setSprint(e.target.value)} aria-label="Sprint">
          <option value="">Tous les sprints</option>
          {o.sprints.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({STATE_LABELS[s.state].toLowerCase()})</option>
          ))}
          <option value="__backlog">Backlog</option>
        </select>
        <select className="input input-auto" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Projet">
          <option value="">Tous les projets</option>
          <option value="__none">Non reliés à un projet</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <input className="input input-auto" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={withDone} onChange={(e) => setWithDone(e.target.checked)} /> Terminés
        </label>
      </div>
      {who === 'mine' && !anyMine && (
        <p className="muted small">Aucun ticket assigné à votre nom ({me.name}) : le hub rapproche les tickets par l’e-mail ou le nom de la personne assignée dans Jira.</p>
      )}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <strong>{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</strong>
          <select className="input input-auto" value={bulkProject} onChange={(e) => setBulkProject(e.target.value)} aria-label="Projet à relier">
            <option value="">Choisir un projet…</option>
            {activeProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button className="btn btn-primary btn-sm" disabled={busy || !bulkProject} onClick={() => void link([...selected], bulkProject)}>Relier au projet</button>
          <button className="btn btn-sm" disabled={busy} onClick={() => void link([...selected], null)}>Détacher</button>
          <button className="btn-link small" onClick={() => setSelected(new Set())}>Annuler</button>
        </div>
      )}
      {!rows.length ? (
        <EmptyState>Aucun ticket ne correspond aux filtres.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input type="checkbox" aria-label="Tout sélectionner" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(rows.map((t) => t.key)))} />
                </th>
                <th>Ticket</th>
                <th>Statut</th>
                <th>Assigné</th>
                <th>Sprint</th>
                <th className="num">SP</th>
                <th>Échéance</th>
                <th>Projet du hub</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const url = jiraIssueUrl(o.site, t.key);
                return (
                  <tr key={t.key} className={t.statusCategory === 'done' ? 'row-done' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Sélectionner ${t.key}`}
                        checked={selected.has(t.key)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(t.key);
                            else n.delete(t.key);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td>
                      {url ? <a href={url} target="_blank" rel="noreferrer" className="mono strong-link">{t.key}</a> : <span className="mono">{t.key}</span>} {t.summary}
                      <div className="muted small">{[t.type, t.priority, t.parent && `↳ ${t.parent}`].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="nowrap"><JiraStatus t={t} /></td>
                    <td className="small nowrap">{t.assignee || <span className="muted">Non assigné</span>}</td>
                    <td className="small">{sprintLabel(t)}</td>
                    <td className="num">{t.storyPoints === null ? '–' : fmt(t.storyPoints)}</td>
                    <td className="small nowrap">{t.dueDate ? shortDay(t.dueDate) : '–'}</td>
                    <td>
                      <select className="input input-sm" value={t.projectId ?? ''} disabled={busy} onChange={(e) => void link([t.key], e.target.value || null)} aria-label={`Projet de ${t.key}`}>
                        <option value="">—</option>
                        {t.projectId && !activeProjects.some((p) => p.id === t.projectId) && <option value={t.projectId}>{t.projectName}</option>}
                        {activeProjects.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
