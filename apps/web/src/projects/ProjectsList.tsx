import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  CLOSED_PROJECT_STATUSES,
  HEALTHS,
  HEALTH_ICONS,
  HEALTH_LABELS,
  isMyProject,
  PRIORITIES,
  type ProjectStatus,
  type ProjectSummary,
} from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner, formatDate, shortUser } from '../components/ui';
import { DueLabel, PriorityTag, ProjectStatusBadge } from './common';
import { useUsers } from '../users/context';
import { useSettings } from '../settings/context';
import { FollowButton, MyProjectsCheck, useMyProjectsFilter } from './mine';
import { NewProjectDialog } from './NewProjectDialog';

type StatusFilter = ProjectStatus | 'actifs' | 'tous';
type Sort = 'recent' | 'echeance' | 'priorite' | 'nom';

export function ProjectsList() {
  const { lists } = useSettings();
  const { email } = useAuth();
  const { name } = useUsers();
  const { data, setData, error, loading } = useLoad(() => api.listProjects(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('actifs');
  const [mine, setMine] = useMyProjectsFilter();
  const [sort, setSort] = useState<Sort>('recent');
  const [domain, setDomain] = useState('');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data ?? []).filter((p) => {
      if (status === 'actifs' && CLOSED_PROJECT_STATUSES.includes(p.status)) return false;
      if (status !== 'actifs' && status !== 'tous' && p.status !== status) return false;
      if (mine && !isMyProject(p, email)) return false;
      if (domain && !p.domains.includes(domain)) return false;
      if (!needle) return true;
      return [p.name, p.code, p.demandeur, p.chefDeProjet, p.blockedReason, ...p.stats.prestataires, ...p.tags, ...p.domains].some((s) => s.toLowerCase().includes(needle));
    });
    const prio = (p: ProjectSummary) => -PRIORITIES.indexOf(p.priority);
    return list.sort((a, b) => {
      if (sort === 'nom') return a.name.localeCompare(b.name, 'fr');
      if (sort === 'priorite') return prio(a) - prio(b) || HEALTHS.indexOf(b.health) - HEALTHS.indexOf(a.health);
      if (sort === 'echeance') return (a.stats.nextJalon?.date || a.targetDate || '9999').localeCompare(b.stats.nextJalon?.date || b.targetDate || '9999');
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [data, q, status, mine, sort, email, domain]);
  // Domaines du paramétrage, et ceux encore portés par un projet après leur retrait du paramétrage.
  const domains = [...new Set([...lists.projectDomains, ...(data ?? []).flatMap((p) => p.domains)])];

  const active = (data ?? []).filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status));
  const counters = {
    actifs: active.length,
    rouge: active.filter((p) => p.health === 'rouge').length,
    orange: active.filter((p) => p.health === 'orange').length,
    retard: active.reduce((n, p) => n + p.stats.overdueTasks, 0),
    bloques: active.filter((p) => p.blocked).length,
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Projets</h1>
          <p className="muted">Tout le suivi d’un projet au même endroit : intervenants, prestations, tickets, planning, documents, journal, risques et cahiers des charges.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nouveau projet</button>
        </div>
      </div>

      {data && data.length > 0 && (
        <div className="kpis">
          <div className="kpi"><span className="kpi-value">{counters.actifs}</span><span className="kpi-label">projets actifs</span></div>
          <div className={`kpi${counters.rouge ? ' kpi-danger' : ''}`}><span className="kpi-value">{counters.rouge}</span><span className="kpi-label">⛈️ en difficulté</span></div>
          <div className={`kpi${counters.orange ? ' kpi-warn' : ''}`}><span className="kpi-value">{counters.orange}</span><span className="kpi-label">☁️ en vigilance</span></div>
          <div className={`kpi${counters.bloques ? ' kpi-danger' : ''}`}><span className="kpi-value">{counters.bloques}</span><span className="kpi-label">⛔ bloqués</span></div>
          <div className={`kpi${counters.retard ? ' kpi-danger' : ''}`}><span className="kpi-value">{counters.retard}</span><span className="kpi-label">tickets en retard</span></div>
        </div>
      )}

      <div className="filters">
        <input className="input" placeholder="Rechercher (nom, code, prestataire, demandeur, étiquette)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="actifs">Projets actifs</option>
          <option value="tous">Tous les projets</option>
          {lists.statuses.project.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        {domains.length > 0 && (
          <select className="input" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domaine">
            <option value="">Tous les domaines</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">Modifiés récemment</option>
          <option value="echeance">Prochaine échéance</option>
          <option value="priorite">Priorité</option>
          <option value="nom">Nom</option>
        </select>
        <MyProjectsCheck mine={mine} setMine={setMine} />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>
          {data?.length ? (
            'Aucun projet ne correspond à la recherche.'
          ) : (
            <>
              <p>Aucun projet pour l’instant.</p>
              <button className="btn btn-primary" onClick={() => setCreating(true)}>Créer le premier projet</button>
            </>
          )}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Statut</th>
                <th>Chefs de projet</th>
                <th>Prochaine échéance</th>
                <th className="num">Tickets</th>
                <th>Modifié</th>
                <th aria-label="Suivi" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="weather-emoji" title={`${HEALTH_LABELS[p.health]}${p.healthComment ? ` : ${p.healthComment}` : ''}`}>{HEALTH_ICONS[p.health]}</span> <Link to={`/projets/${p.id}`} className="strong">{p.name}</Link> <PriorityTag priority={p.priority} hideNormal />
                    <div className="muted small">{[p.code, p.demandeur, p.domains.join(', ')].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    <ProjectStatusBadge status={p.status} />
                    {p.blocked && <div className="due-late small" title={p.blockedReason}>⛔ Bloqué</div>}
                  </td>
                  <td>
                    {p.chefDeProjetIds.length || p.chefDeProjet ? (
                      <span className="chef-badges">
                        {(p.chefDeProjetIds.length ? p.chefDeProjetIds.map(name) : [p.chefDeProjet]).map((n) => <span key={n} className="badge badge-chef">{n}</span>)}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {p.stats.nextJalon ? (
                      <><DueLabel date={p.stats.nextJalon.date} /> <div className="muted small">{p.stats.nextJalon.label}</div></>
                    ) : p.targetDate ? (
                      <><DueLabel date={p.targetDate} /> <div className="muted small">Fin visée</div></>
                    ) : (
                      <span className="muted">—</span>
                    )}
                    {p.stats.lateJalons > 0 && <div className="due-late small">{p.stats.lateJalons} jalon{p.stats.lateJalons > 1 ? 's' : ''} en retard</div>}
                  </td>
                  <td className="num">
                    {p.stats.openTasks}
                    {p.stats.overdueTasks > 0 && <div className="due-late small">{p.stats.overdueTasks} en retard</div>}
                  </td>
                  <td className="small">{formatDate(p.updatedAt.slice(0, 10))}<div className="muted">{shortUser(p.updatedBy)}</div></td>
                  <td>
                    <FollowButton small project={p} onChange={(followers) => setData((d) => d && d.map((x) => (x.id === p.id ? { ...x, followers } : x)))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
