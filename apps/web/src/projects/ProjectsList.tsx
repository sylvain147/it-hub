import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  CLOSED_PROJECT_STATUSES,
  HEALTHS,
  HEALTH_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  type Priority,
  type ProjectStatus,
  type ProjectSummary,
} from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDate, shortUser } from '../components/ui';
import { DueLabel, HealthBadge, PriorityTag, ProjectStatusBadge, euros, isMine } from './common';

type StatusFilter = ProjectStatus | 'actifs' | 'tous';
type Sort = 'recent' | 'echeance' | 'priorite' | 'nom';

export function ProjectsList() {
  const { email } = useAuth();
  const { data, error, loading } = useLoad(() => api.listProjects(), []);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('actifs');
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState<Sort>('recent');
  const [creating, setCreating] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (data ?? []).filter((p) => {
      if (status === 'actifs' && CLOSED_PROJECT_STATUSES.includes(p.status)) return false;
      if (status !== 'actifs' && status !== 'tous' && p.status !== status) return false;
      if (mine && !isMine(p.chefDeProjet, email) && p.createdBy !== email) return false;
      if (!needle) return true;
      return [p.name, p.code, p.demandeur, p.chefDeProjet, ...p.stats.prestataires, ...p.tags].some((s) => s.toLowerCase().includes(needle));
    });
    const prio = (p: ProjectSummary) => -PRIORITIES.indexOf(p.priority);
    return list.sort((a, b) => {
      if (sort === 'nom') return a.name.localeCompare(b.name, 'fr');
      if (sort === 'priorite') return prio(a) - prio(b) || HEALTHS.indexOf(b.health) - HEALTHS.indexOf(a.health);
      if (sort === 'echeance') return (a.stats.nextJalon?.date || a.targetDate || '9999').localeCompare(b.stats.nextJalon?.date || b.targetDate || '9999');
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [data, q, status, mine, sort, email]);

  const active = (data ?? []).filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status));
  const counters = {
    actifs: active.length,
    rouge: active.filter((p) => p.health === 'rouge').length,
    orange: active.filter((p) => p.health === 'orange').length,
    retard: active.reduce((n, p) => n + p.stats.overdueTasks, 0),
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Projets</h1>
          <p className="muted">Tout le suivi d’un projet au même endroit : intervenants, prestations, tâches, planning, documents, journal, risques et cahiers des charges.</p>
        </div>
        <div className="row-actions">
          <Link to="/cdc" className="btn">📄 Tous les cahiers des charges</Link>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nouveau projet</button>
        </div>
      </div>

      {data && data.length > 0 && (
        <div className="kpis">
          <div className="kpi"><span className="kpi-value">{counters.actifs}</span><span className="kpi-label">projets actifs</span></div>
          <div className={`kpi${counters.rouge ? ' kpi-danger' : ''}`}><span className="kpi-value">{counters.rouge}</span><span className="kpi-label">🔴 en difficulté</span></div>
          <div className={`kpi${counters.orange ? ' kpi-warn' : ''}`}><span className="kpi-value">{counters.orange}</span><span className="kpi-label">🟠 en vigilance</span></div>
          <div className={`kpi${counters.retard ? ' kpi-danger' : ''}`}><span className="kpi-value">{counters.retard}</span><span className="kpi-label">tâches en retard</span></div>
        </div>
      )}

      <div className="filters">
        <input className="input" placeholder="Rechercher (nom, code, prestataire, demandeur, étiquette)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="actifs">Projets actifs</option>
          <option value="tous">Tous les projets</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="recent">Modifiés récemment</option>
          <option value="echeance">Prochaine échéance</option>
          <option value="priorite">Priorité</option>
          <option value="nom">Nom</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mes projets
        </label>
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
                <th>Météo</th>
                <th>Chef de projet</th>
                <th>Prestataires</th>
                <th>Prochaine échéance</th>
                <th className="num">Tâches</th>
                <th className="num">Budget</th>
                <th className="num">CDC</th>
                <th>Modifié</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/projets/${p.id}`} className="strong">{p.name}</Link> <PriorityTag priority={p.priority} hideNormal />
                    <div className="muted small">{[p.code, p.demandeur].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td><ProjectStatusBadge status={p.status} /></td>
                  <td title={p.healthComment}><HealthBadge health={p.health} /></td>
                  <td>{p.chefDeProjet || <span className="muted">—</span>}</td>
                  <td>{p.stats.prestataires.join(', ') || <span className="muted">—</span>}</td>
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
                  <td className="num">{p.stats.montantPrevu ? euros(p.stats.montantPrevu) : p.budgetPrevu != null ? euros(p.budgetPrevu) : <span className="muted">—</span>}</td>
                  <td className="num">{p.cdcCount || <span className="muted">0</span>}</td>
                  <td className="small">{formatDate(p.updatedAt.slice(0, 10))}<div className="muted">{shortUser(p.updatedBy)}</div></td>
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

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const { email } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('cadrage');
  const [priority, setPriority] = useState<Priority>('normale');
  const [chef, setChef] = useState(shortUser(email));
  const [demandeur, setDemandeur] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject({ name, code, status, priority, chefDeProjet: chef, demandeur, targetDate, description });
      navigate(`/projets/${p.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouveau projet"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>
            {busy && <Spinner small />} Créer le projet
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <label className="field span-2">
          <span>Nom du projet *</span>
          <input className="input input-title" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Migration de l’offre Coliéco" onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
        </label>
        <label className="field">
          <span>Code</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex. COL-27" />
        </label>
        <label className="field">
          <span>Date de fin visée</span>
          <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Statut</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Priorité</span>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Chef de projet</span>
          <input className="input" value={chef} onChange={(e) => setChef(e.target.value)} />
        </label>
        <label className="field">
          <span>Demandeur (direction, service)</span>
          <input className="input" value={demandeur} onChange={(e) => setDemandeur(e.target.value)} placeholder="ex. Logistique" />
        </label>
        <label className="field span-2">
          <span>Description <span className="muted">(facultatif, complétable ensuite)</span></span>
          <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Le contexte, le besoin, en quelques phrases." />
        </label>
      </div>
      <p className="muted small">Météo : {HEALTH_LABELS.vert} par défaut. Vous pourrez ensuite ajouter intervenants, prestations, planning, documents…</p>
    </Modal>
  );
}
