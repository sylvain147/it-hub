import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CDC_STATUSES, CDC_STATUS_LABELS, PROJECT_PHASE_LABELS, type CdcStatus } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner, StatusBadge, formatDate, shortUser } from '../components/ui';

export function CdcList() {
  const { data, error, loading } = useLoad(() => api.listCdcs(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<CdcStatus | 'actifs' | 'tous'>('actifs');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((c) => {
      if (status === 'actifs' && c.status === 'archive') return false;
      if (status !== 'actifs' && status !== 'tous' && c.status !== status) return false;
      if (!needle) return true;
      return [c.title, c.prestataire, c.projet].some((s) => s.toLowerCase().includes(needle));
    });
  }, [data, q, status]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Cahiers des charges</h1>
        <Link to="/cdc/nouveau" className="btn btn-primary">+ Nouveau cahier des charges</Link>
      </div>
      <div className="filters">
        <input className="input" placeholder="Rechercher (titre, prestataire, projet)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="actifs">Tous sauf archivés</option>
          <option value="tous">Tous</option>
          {CDC_STATUSES.map((s) => (
            <option key={s} value={s}>{CDC_STATUS_LABELS[s]}</option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState>
          {data?.length ? 'Aucun cahier des charges ne correspond à la recherche.' : 'Aucun cahier des charges pour l’instant. Créez le premier à partir d’une transcription de réunion.'}
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Titre</th>
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
                  <td><Link to={`/cdc/${c.id}`} className="strong">{c.title}</Link>{c.projet && <div className="muted small">{c.projet}</div>}</td>
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
