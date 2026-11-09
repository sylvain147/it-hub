import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { PROJECT_PHASE_LABELS, type CdcStatus } from '@samm/shared';
import { useSettings } from '../settings/context';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ProjectStatusBadge } from '../projects/common';
import { useAuth } from '../auth';
import { MyProjectsCheck, myProjectIds, useMyProjectsFilter } from '../projects/mine';
import { EmptyState, ErrorBox, Spinner, StatusBadge, formatDate, shortUser } from '../components/ui';

export function CdcList() {
  const { lists } = useSettings();
  const { data, error, loading } = useLoad(() => api.listCdcs(), []);
  const { data: projects } = useLoad(() => api.listProjects(), []);
  const projectById = new Map((projects ?? []).map((p) => [p.id, p]));
  const { email } = useAuth();
  const [orphans, setOrphans] = useState(false);
  const [mine, setMine] = useMyProjectsFilter();
  const mineIds = useMemo(() => myProjectIds(projects, email), [projects, email]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CdcStatus | 'actifs' | 'tous'>('actifs');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (status === 'actifs' && c.status === 'archive') return false;
      if (status !== 'actifs' && status !== 'tous' && c.status !== status) return false;
      if (orphans && c.projectId) return false;
      if (mine && !orphans && !mineIds.has(c.projectId ?? '')) return false;
      if (!needle) return true;
      return [c.title, c.prestataire, c.projet].some((s) => s.toLowerCase().includes(needle));
    });
  }, [data, q, status, orphans, mine, mineIds]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cahiers des charges</h1>
          <p className="muted">Tous les cahiers des charges de l’équipe. Pour en rédiger un nouveau, ouvrez le projet concerné (onglet « Cahiers des charges »).</p>
        </div>
        <Link to="/projets" className="btn btn-primary">📁 Aller aux projets</Link>
      </div>
      <div className="filters">
        <input className="input" placeholder="Rechercher (titre, prestataire, projet)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="actifs">Tous sauf archivés</option>
          <option value="tous">Tous</option>
          {lists.statuses.cdc.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <MyProjectsCheck mine={mine} setMine={setMine} />
        <label className="check">
          <input type="checkbox" checked={orphans} onChange={(e) => setOrphans(e.target.checked)} /> Sans projet uniquement
        </label>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>
          {data?.length ? 'Aucun cahier des charges ne correspond à la recherche.' : 'Aucun cahier des charges pour l’instant. Créez-les depuis un projet.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Titre</th>
                <th>Projet</th>
                <th>Prestataire</th>
                <th>Statut</th>
                <th>Phase</th>
                <th>Prochaine échéance</th>
                <th className="num">Estimation</th>
                <th>Version</th>
                <th className="num">Questions</th>
                <th>Modifié</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/cdc/${c.id}`} className="strong">{c.title}</Link></td>
                  <td>
                    {c.projectId && projectById.get(c.projectId) ? (
                      <><Link to={`/projets/${c.projectId}?onglet=cdc`}>{projectById.get(c.projectId)!.name}</Link> <ProjectStatusBadge status={projectById.get(c.projectId)!.status} /></>
                    ) : (
                      <span className="muted">{c.projet || '—'}{!c.projectId && <span className="badge">sans projet</span>}</span>
                    )}
                  </td>
                  <td>{c.prestataire || <span className="muted">—</span>}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.phase ? PROJECT_PHASE_LABELS[c.phase] : <span className="muted">—</span>}</td>
                  <td>{c.nextJalon ? <>{formatDate(c.nextJalon.date)} <span className="muted small">{c.nextJalon.label}</span></> : <span className="muted">—</span>}</td>
                  <td className="num">{c.estimationJours != null ? `${c.estimationJours} j/h` : <span className="muted">—</span>}</td>
                  <td>v{c.currentVersion.label}</td>
                  <td className="num">{c.openQuestions > 0 ? <span className="pill">{c.openQuestions}</span> : <span className="muted">0</span>}</td>
                  <td className="small">{formatDate(c.updatedAt.slice(0, 10))}<div className="muted">{shortUser(c.updatedBy)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
