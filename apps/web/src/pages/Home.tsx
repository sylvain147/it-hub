import { useState } from 'react';
import { Link } from 'react-router';
import { CLOSED_PROJECT_STATUSES, HEALTHS } from '@samm/shared';
import { MODULES } from '../modules';
import { api } from '../api';
import { useLoad } from '../hooks';
import { shortUser } from '../components/ui';
import { useAuth } from '../auth';
import { useUsers } from '../users/context';
import { DueLabel, HealthBadge, ProjectStatusBadge } from '../projects/common';
import { ActivityList } from '../projects/OverviewTab';

export function Home() {
  const { me } = useAuth();
  const [allTasks, setAllTasks] = useState(false);
  const { data: projects } = useLoad(() => api.listProjects(), []);
  const { data: todos } = useLoad(() => api.todos(allTasks ? 'all' : undefined), [allTasks]);
  const { data: activity } = useLoad(() => api.activity(), []);
  const { name } = useUsers();

  const active = (projects ?? []).filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status));
  // Projets à surveiller d'abord (météo rouge, puis orange), puis les plus récemment modifiés.
  const watch = [...active].sort((a, b) => HEALTHS.indexOf(b.health) - HEALTHS.indexOf(a.health) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  // Tâches de projet et tâches personnelles ouvertes, par échéance.
  const myTasks = [
    ...(todos?.project ?? []).map((t) => ({ ...t, where: t.projectName, to: `/projets/${t.projectId}?onglet=taches`, who: t.assignee })),
    ...(todos?.personal ?? []).filter((t) => t.status !== 'fait').map((t) => ({ ...t, where: 'Personnelle', to: '/taches', who: name(t.assigneeId) })),
  ]
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    .slice(0, 12);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const deadlines = active
    .filter((p) => p.stats.nextJalon && p.stats.nextJalon.date <= in30)
    .sort((a, b) => a.stats.nextJalon!.date.localeCompare(b.stats.nextJalon!.date))
    .slice(0, 8);

  return (
    <div className="page page-wide">
      <h1>Bonjour {me.name.split(' ')[0]} 👋</h1>
      <p className="muted">Le hub de l’équipe IT.</p>
      <div className="module-grid">
        {MODULES.map((m) => (
          <Link key={m.id} to={m.path} className="module-card">
            <div className="module-icon">{m.icon}</div>
            <div>
              <h3>{m.title}</h3>
              <p>{m.description}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="home-grid">
        <section className="card">
          <div className="card-head">
            <h2>{allTasks ? 'Tâches ouvertes' : 'Mes tâches'}</h2>
            <span className="row-actions">
              {me.permissions.seeAllTodos && (
                <button className="btn-link small" onClick={() => setAllTasks(!allTasks)}>{allTasks ? 'Seulement les miennes' : 'Toute l’équipe'}</button>
              )}
              <Link to={allTasks ? '/taches?qui=all' : '/taches'} className="small">Tout voir →</Link>
            </span>
          </div>
          {myTasks.length === 0 ? (
            <p className="muted">{allTasks ? 'Aucune tâche ouverte.' : 'Aucune tâche ouverte à votre nom.'}</p>
          ) : (
            <ul className="list-plain">
              {myTasks.map((t) => (
                <li key={t.id} className="home-task">
                  <DueLabel date={t.dueDate} />
                  <span>
                    <Link to={t.to}>{t.title}</Link>
                    <div className="muted small">{t.where}{allTasks && t.who && ` · ${t.who}`}{t.status === 'bloque' && ' · bloquée'}</div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Échéances des 30 prochains jours</h2>
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
            <div className="project-cards">
              {watch.map((p) => (
                <Link key={p.id} to={`/projets/${p.id}`} className="project-card">
                  <div className="project-card-head">
                    <strong>{p.name}</strong>
                    <HealthBadge health={p.health} withLabel={false} />
                  </div>
                  <div className="row-actions">
                    <ProjectStatusBadge status={p.status} />
                    {p.stats.overdueTasks > 0 && <span className="badge badge-danger">{p.stats.overdueTasks} en retard</span>}
                  </div>
                  <div className="muted small">
                    {p.stats.openTasks} tâche{p.stats.openTasks > 1 ? 's' : ''} · {p.stats.prestataires.join(', ') || 'aucun prestataire'}
                  </div>
                  {p.healthComment && <div className="small clamp">{p.healthComment}</div>}
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
