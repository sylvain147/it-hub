import { Link } from 'react-router';
import { MODULES } from '../modules';
import { api } from '../api';
import { useLoad } from '../hooks';
import { StatusBadge, formatDate, shortUser } from '../components/ui';
import { useAuth } from '../auth';

export function Home() {
  const { email } = useAuth();
  const { data } = useLoad(() => api.listCdcs(), []);
  const recent = (data ?? []).filter((c) => c.status !== 'archive').slice(0, 6);
  const openQuestions = (data ?? []).reduce((n, c) => n + (c.status === 'archive' ? 0 : c.openQuestions), 0);
  return (
    <div className="page">
      <h1>Bonjour {shortUser(email)} 👋</h1>
      <p className="muted">Le hub de l’équipe IT. Choisissez un module.</p>
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
        <div className="module-card module-soon">
          <div className="module-icon">➕</div>
          <div>
            <h3>Prochains modules</h3>
            <p>Les prochaines fonctionnalités du hub viendront s’ajouter ici.</p>
          </div>
        </div>
      </div>

      {recent.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h2>Cahiers des charges récents</h2>
            {openQuestions > 0 && <span className="pill">{openQuestions} question{openQuestions > 1 ? 's' : ''} ouverte{openQuestions > 1 ? 's' : ''}</span>}
          </div>
          <ul className="recent">
            {recent.map((c) => (
              <li key={c.id}>
                <Link to={`/cdc/${c.id}`}>{c.title}</Link>
                <span className="muted">{c.prestataire}</span>
                <StatusBadge status={c.status} />
                <span className="muted small">modifié le {formatDate(c.updatedAt.slice(0, 10))} par {shortUser(c.updatedBy)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
