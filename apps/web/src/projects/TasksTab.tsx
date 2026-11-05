import { useState } from 'react';
import { Link } from 'react-router';
import { jiraIssueUrl, type JiraTaskView } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, toast } from '../components/ui';
import { useProject } from './common';
import { byDue, projectRow, QuickAdd, TaskChecklist, TaskModal, type TaskRow } from '../tasks/tasks';
import { JiraStatus } from '../jira/JiraPage';

/** Onglet « Tâches » d'un projet : liste à cocher, et tickets Jira reliés au projet (lecture seule). */
export function TasksTab() {
  const { project, reload } = useProject();
  const { email } = useAuth();
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null);
  const [mine, setMine] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const rows = project.items.tasks.map((t) => projectRow(t, project.id, project.name)).filter((t) => !mine || t.assigneeId === email);
  const open = rows.filter((t) => !t.done).sort(byDue);
  const done = rows.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));

  return (
    <div>
      <section className="card">
        <div className="toolbar-row">
          <QuickAdd placeholder="+ Nouvelle tâche : tapez l’intitulé puis Entrée" onAdd={async (title) => { await api.createItem(project.id, 'tasks', { title }); await reload(); }} />
          <button className="btn btn-ghost" onClick={() => setEditing('new')}>Avec des détails…</button>
          <span className="tb-flex" />
          <label className="check">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Seulement les miennes
          </label>
        </div>
        {!project.items.tasks.length ? (
          <EmptyState>Aucune tâche. Ajoutez-en ci-dessus, ou faites-les proposer par l’assistant à partir d’un compte rendu de réunion (onglet Journal).</EmptyState>
        ) : (
          <>
            {open.length ? <TaskChecklist rows={open} onChanged={reload} onEdit={setEditing} /> : <p className="muted">Tout est fait. 🎉</p>}
            {done.length > 0 && (
              <>
                <button className="btn-link small mt" onClick={() => setShowDone(!showDone)}>
                  {showDone ? 'Masquer' : 'Afficher'} les {done.length} tâche{done.length > 1 ? 's' : ''} faite{done.length > 1 ? 's' : ''}
                </button>
                {showDone && <TaskChecklist rows={done} onChanged={reload} onEdit={setEditing} />}
              </>
            )}
          </>
        )}
      </section>
      <JiraTasksCard />
      {editing && (
        <TaskModal
          task={editing === 'new' ? null : editing}
          defaults={{ projectId: project.id, assigneeId: email }}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </div>
  );
}

/** Tickets Jira reliés au projet : lecture seule, ils se modifient dans Jira. */
function JiraTasksCard() {
  const { project } = useProject();
  const conf = useLoad(() => api.jiraConfig(), []);
  const tasks = useLoad(() => api.jiraTasks(project.id), [project.id]);
  const [showDone, setShowDone] = useState(false);
  if (!conf.data?.configured) return null;
  const list = tasks.data ?? [];
  const open = list.filter((t) => t.statusCategory !== 'done');
  const shown = showDone ? list : open;

  async function unlink(t: JiraTaskView) {
    try {
      await api.linkJiraTasks([t.key], null);
      toast(`${t.key} n’est plus relié au projet.`);
      await tasks.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Tickets Jira <span className="muted small">({open.length} ouvert{open.length > 1 ? 's' : ''} sur {list.length})</span></h2>
        <Link to={`/jira?projet=${project.id}`} className="small">Relier des tickets →</Link>
      </div>
      {!list.length ? (
        <p className="muted small">Aucun ticket Jira relié à ce projet. Depuis l’onglet Jira, importez vos tickets puis reliez-les au projet.</p>
      ) : (
        <>
          <ul className="checklist">
            {shown.map((t) => {
              const url = jiraIssueUrl(conf.data!.site, t.key);
              return (
                <li key={t.key} className={t.statusCategory === 'done' ? 'check-item done' : 'check-item'}>
                  <span className="jira-key">{url ? <a href={url} target="_blank" rel="noreferrer">{t.key}</a> : t.key}</span>
                  <div className="check-body">
                    <div className="check-line">
                      <span className="check-title-ro">{t.summary}</span>
                      <span className="check-meta">
                        <JiraStatus t={t} />
                        {t.assignee && <span className="badge">{t.assignee}</span>}
                        <button className="btn-icon" title="Délier du projet" onClick={() => void unlink(t)}>✕</button>
                      </span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {list.length > open.length && (
            <button className="btn-link small" onClick={() => setShowDone(!showDone)}>{showDone ? 'Masquer les tickets terminés' : `Afficher les ${list.length - open.length} tickets terminés`}</button>
          )}
          <p className="muted small">Les tickets Jira se modifient dans Jira ; leurs données sont celles du dernier import.</p>
        </>
      )}
    </section>
  );
}
