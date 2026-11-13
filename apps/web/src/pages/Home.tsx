import { useState } from 'react';
import { Link } from 'react-router';
import { CLOSED_PROJECT_STATUSES, HEALTHS, ticketKey } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { useAuth } from '../auth';
import { useUsers } from '../users/context';
import { DueLabel, HealthBadge, ProjectSteps } from '../projects/common';
import { ActivityList } from '../projects/OverviewTab';
import { ticketPath } from '../sprints/tickets';

export function Home() {
  const { me } = useAuth();
  const [allTasks, setAllTasks] = useState(false);
  const { data: projects } = useLoad(() => api.listProjects(), []);
  const { data: todos } = useLoad(() => api.todos(allTasks ? 'all' : undefined), [allTasks]);
  // Tickets de tous les tableaux.
  const { data: tickets } = useLoad(() => api.allTickets(), []);
  const { data: activity } = useLoad(() => api.activity(), []);
  const { name } = useUsers();

  const active = (projects ?? []).filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status));
  // Projets à surveiller d'abord (bloqués, puis météo rouge, puis orange), puis les plus récemment modifiés.
  const watch = [...active]
    .sort((a, b) => Number(b.blocked) - Number(a.blocked) || HEALTHS.indexOf(b.health) - HEALTHS.indexOf(a.health) || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 8);
  // La to-do et les tickets restent deux listes distinctes, chacune par échéance.
  const byDueDate = (a: { dueDate: string }, b: { dueDate: string }) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
  // Ma to-do dans l'ordre choisi par glisser-déposer, puis par échéance.
  const rank = (t: { position?: number }) => t.position ?? Number.MAX_SAFE_INTEGER;
  const myTodos = (todos?.personal ?? []).filter((t) => !t.done).sort((a, b) => rank(a) - rank(b) || byDueDate(a, b)).slice(0, 10);
  const myTickets = (tickets ?? []).filter((t) => !t.done && (allTasks || t.assigneeId === me.email)).sort(byDueDate).slice(0, 10);
  const projectName = (id: string) => (projects ?? []).find((p) => p.id === id)?.name ?? '';
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const deadlines = active
    .filter((p) => p.stats.nextJalon && p.stats.nextJalon.date <= in30)
    .sort((a, b) => a.stats.nextJalon!.date.localeCompare(b.stats.nextJalon!.date))
    .slice(0, 8);

  return (
    <div className="page page-wide">
      <h1>Bonjour {me.name.split(' ')[0]} 👋</h1>
      <p className="muted">Hobbit, le hub de l’équipe IT.</p>
      <div className="home-grid">
        <section className="card">
          <div className="card-head">
            <h2>{allTasks ? 'To-do de l’équipe' : 'Ma to-do'}</h2>
            <span className="row-actions">
              {me.permissions.seeAllTodos && (
                <button className="btn-link small" onClick={() => setAllTasks(!allTasks)}>{allTasks ? 'Seulement la mienne' : 'Toute l’équipe'}</button>
              )}
              <Link to={allTasks ? '/todo?qui=all' : '/todo'} className="small">Tout voir →</Link>
            </span>
          </div>
          {myTodos.length === 0 ? (
            <p className="muted">Rien à faire.</p>
          ) : (
            <ul className="list-plain">
              {myTodos.map((t) => (
                <li key={t.id} className="home-task">
                  <DueLabel date={t.dueDate} />
                  <span>
                    <Link to="/todo">{t.title}</Link>
                    {(t.projectId || allTasks) && (
                      <div className="muted small">{[projectName(t.projectId), allTasks ? name(t.assigneeId) : ''].filter(Boolean).join(' · ')}</div>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>{allTasks ? 'Tickets ouverts de l’équipe' : 'Mes tickets ouverts'}</h2>
            <Link to="/sprints" className="small">Sprints →</Link>
          </div>
          {myTickets.length === 0 ? (
            <p className="muted">{allTasks ? 'Aucun ticket ouvert.' : 'Aucun ticket ouvert à votre nom.'}</p>
          ) : (
            <ul className="list-plain">
              {myTickets.map((t) => (
                <li key={t.id} className="home-task">
                  <DueLabel date={t.dueDate} />
                  <span>
                    <Link to={ticketPath(t)}>{t.title}</Link>
                    <div className="muted small">{ticketKey(t)} · {t.projectName}{allTasks && t.assignee && ` · ${t.assignee}`}</div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card span-2-home">
          <div className="card-head">
            <h2>Échéances des 30 prochains jours</h2>
            <Link to="/planning" className="small">Frise de tous les projets →</Link>
          </div>
          {deadlines.length === 0 ? (
            <p className="muted">Aucun jalon dans les 30 prochains jours.</p>
          ) : (
            <ul className="list-plain">
              {deadlines.map((p) => (
                <li key={p.id} className="home-task">
                  <DueLabel date={p.stats.nextJalon!.date} />
                  <span>
                    <Link to={`/projets/${p.id}?onglet=planning`}>{p.stats.nextJalon!.label}</Link>
                    <div className="muted small">{p.name}</div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card span-2-home">
          <div className="card-head">
            <h2>Projets actifs</h2>
            <Link to="/projets" className="small">Tous les projets →</Link>
          </div>
          {watch.length === 0 ? (
            <p className="muted">Aucun projet actif. <Link to="/projets">Créer un projet</Link></p>
          ) : (
            <div className="home-projects">
              {watch.map((p) => (
                <Link key={p.id} to={`/projets/${p.id}`} className="home-project">
                  <div className="home-project-name">
                    <strong title={p.name}><HealthBadge health={p.health} withLabel={false} /> {p.name}</strong>
                    <span className="muted small">
                      {p.stats.openTasks} ticket{p.stats.openTasks > 1 ? 's' : ''} ouvert{p.stats.openTasks > 1 ? 's' : ''}
                      {p.stats.overdueTasks > 0 && <span className="due-late"> · {p.stats.overdueTasks} en retard</span>}
                      {p.domains.length > 0 && ` · ${p.domains.join(', ')}`}
                    </span>
                    {p.healthComment && <span className="small clamp health-comment" title={p.healthComment}>« {p.healthComment} »</span>}
                  </div>
                  <ProjectSteps project={p} compact />
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card span-2-home">
          <h2>Activité récente</h2>
          <ActivityList entries={(activity ?? []).slice(0, 12)} showProject />
        </section>
      </div>
    </div>
  );
}
