import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { JiraBoard, JiraConfigInfo, JiraSprintListItem } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner, formatDate, formatDateTime, toast } from '../components/ui';
import { useProject } from '../projects/common';
import { fieldsOf } from '../projects/OverviewTab';

const STATE_LABELS: Record<JiraSprintListItem['state'], string> = { future: 'À venir', active: 'En cours', closed: 'Clos' };
const STATE_BADGES: Record<JiraSprintListItem['state'], string> = { future: 'badge', active: 'badge badge-warn', closed: 'badge badge-ok' };

/** Onglet « Sprints » d'un projet : tableau Jira relié et revue de chaque sprint. */
export function SprintsTab() {
  const { project } = useProject();
  const conf = useLoad(() => api.jiraConfig(), []);
  const [editing, setEditing] = useState(false);

  if (conf.error) return <ErrorBox error={conf.error} />;
  if (!conf.data) return <Spinner />;
  if (!conf.data.configured) {
    return (
      <EmptyState>
        Jira n’est pas encore connecté au hub. Renseignez le site et le jeton d’API dans <Link to="/parametrage?onglet=jira">Paramétrage → Jira</Link>, puis revenez ici
        pour relier ce projet à son tableau Jira.
      </EmptyState>
    );
  }
  if (!project.jiraBoardId || editing) return <LinkBoard conf={conf.data} onDone={() => setEditing(false)} onCancel={project.jiraBoardId ? () => setEditing(false) : undefined} />;
  return <SprintList boardId={project.jiraBoardId} onChangeBoard={() => setEditing(true)} />;
}

function LinkBoard({ conf, onDone, onCancel }: { conf: JiraConfigInfo; onDone: () => void; onCancel?: () => void }) {
  const { project, setProject } = useProject();
  const [key, setKey] = useState(project.jiraProjectKey || project.code.toUpperCase());
  const [boards, setBoards] = useState<JiraBoard[] | null>(null);
  const [boardId, setBoardId] = useState<number | null>(project.jiraBoardId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      const list = await api.jiraBoards(key.trim());
      setBoards(list);
      setBoardId(list.find((b) => b.type === 'scrum')?.id ?? list[0]?.id ?? null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!boardId) return;
    setBusy(true);
    setError(null);
    try {
      setProject(await api.updateProject(project.id, project.rev, { ...fieldsOf(project), jiraProjectKey: key.trim().toUpperCase(), jiraBoardId: boardId }));
      toast('Projet relié au tableau Jira.');
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Relier le projet à Jira</h2>
      <p className="muted small">
        Indiquez la clé du projet Jira (le préfixe des tickets, par exemple « TC » pour TC-123), puis choisissez le tableau Scrum dont vous voulez suivre les sprints.
        {conf.site === 'demo' && ' Jira de démonstration : essayez la clé « TC ».'}
      </p>
      <ErrorBox error={error} />
      <div className="toolbar-row">
        <input
          className="input input-auto"
          value={key}
          onChange={(e) => setKey(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder="Clé Jira (ex. TC)"
          aria-label="Clé du projet Jira"
        />
        <button className="btn" disabled={busy || !key.trim()} onClick={() => void search()}>
          {busy && !boards && <Spinner small />} Chercher les tableaux
        </button>
        {onCancel && <button className="btn btn-ghost" onClick={onCancel}>Annuler</button>}
      </div>
      {boards && !boards.length && <p className="muted small mt">Aucun tableau trouvé pour « {key} ». Vérifiez la clé et que le compte Jira du hub a accès au projet.</p>}
      {boards && boards.length > 0 && (
        <div className="mt">
          {boards.map((b) => (
            <label key={b.id} className="check">
              <input type="radio" name="board" checked={boardId === b.id} onChange={() => setBoardId(b.id)} /> {b.name}{' '}
              <span className="muted small">({b.type === 'scrum' ? 'Scrum' : b.type === 'kanban' ? 'Kanban — pas de sprints' : b.type})</span>
            </label>
          ))}
          <div className="actions mt">
            <button className="btn btn-primary" disabled={busy || !boardId} onClick={() => void save()}>Relier ce tableau</button>
          </div>
        </div>
      )}
    </section>
  );
}

function SprintList({ boardId, onChangeBoard }: { boardId: number; onChangeBoard: () => void }) {
  const { project } = useProject();
  const navigate = useNavigate();
  const sprints = useLoad(() => api.jiraSprints(boardId), [boardId]);
  const [board, setBoard] = useState<JiraBoard | null>(null);
  const [syncing, setSyncing] = useState<number | null>(null);

  useEffect(() => {
    api.jiraBoards(project.jiraProjectKey).then((bs) => setBoard(bs.find((b) => b.id === boardId) ?? null), () => {});
  }, [project.jiraProjectKey, boardId]);

  async function open(s: JiraSprintListItem) {
    if (!s.syncedAt) {
      setSyncing(s.id);
      try {
        await api.syncSprint(s.id, boardId, project.jiraProjectKey);
      } catch (e) {
        toast((e as Error).message, 'error');
        setSyncing(null);
        return;
      }
    }
    navigate(`/projets/${project.id}/sprints/${s.id}`);
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          Sprints {board ? `— ${board.name}` : ''} {project.jiraProjectKey && <span className="muted small">({project.jiraProjectKey})</span>}
        </h2>
        <div className="row-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => void sprints.reload()} disabled={sprints.loading}>Actualiser</button>
          <button className="btn btn-ghost btn-sm" onClick={onChangeBoard}>Changer de tableau</button>
        </div>
      </div>
      <ErrorBox error={sprints.error} />
      {sprints.loading && !sprints.data && <Spinner />}
      {sprints.data && !sprints.data.length && <EmptyState>Aucun sprint sur ce tableau.</EmptyState>}
      {sprints.data && sprints.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Sprint</th>
                <th>État</th>
                <th>Dates</th>
                <th>Revue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sprints.data.map((s) => (
                <tr key={s.id} className={s.state === 'future' ? '' : 'row-click'} onClick={() => s.state !== 'future' && void open(s)}>
                  <td>
                    <strong>{s.name}</strong>
                    {s.goal && <div className="muted small">{s.goal}</div>}
                  </td>
                  <td><span className={STATE_BADGES[s.state]}>{STATE_LABELS[s.state]}</span></td>
                  <td className="small nowrap">
                    {s.startDate ? `${formatDate(s.startDate.slice(0, 10))} → ${s.endDate ? formatDate((s.completeDate ?? s.endDate).slice(0, 10)) : '?'}` : '—'}
                  </td>
                  <td className="small">
                    {s.syncedAt ? (
                      <>
                        {s.issueCount} ticket(s), données du {formatDateTime(s.syncedAt)}
                        {s.hasCompteRendu && <span className="badge badge-ok"> Compte rendu</span>}
                      </>
                    ) : (
                      <span className="muted">Pas encore récupéré</span>
                    )}
                  </td>
                  <td className="num">
                    {s.state !== 'future' && (
                      <button className="btn btn-sm" disabled={syncing !== null}>
                        {syncing === s.id ? <Spinner small /> : s.syncedAt ? 'Ouvrir' : 'Récupérer'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Les données d’un sprint sont récupérées depuis Jira sur demande, puis conservées : la revue reste consultable telle qu’elle était à la date de récupération.
        Pour la mettre à jour, utilisez « Actualiser depuis Jira » dans la revue.
      </p>
    </section>
  );
}
