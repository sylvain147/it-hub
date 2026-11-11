import { useState } from 'react';
import { useNavigate } from 'react-router';
import {
  HEALTHS,
  HEALTH_ICONS,
  HEALTH_LABELS,
  PRIORITIES,
  PRIORITY_LABELS,
  isJalonLate,
  isTaskOverdue,
  projectFieldsSchema,
  riskScore,
  type Health,
  type ProjectDetail,
  type ProjectFields,
  type ProjectSection,
} from '@samm/shared';
import { api, ApiError } from '../api';
import { ErrorBox, Modal, MultiSelect, Spinner, formatDate, formatDateTime, shortUser, toast } from '../components/ui';
import { DueLabel, HealthDot, HealthBadge, MarkdownField, MarkdownView, days, euros, useProject } from './common';
import { hasPending } from './ProjectPage';
import { StatusOptions, useSettings } from '../settings/context';
import { UserChoices, useUsers } from '../users/context';
import { ringClass, useRingHolder } from '../anneau/Anneau';

export function fieldsOf(p: ProjectDetail): ProjectFields {
  return projectFieldsSchema.parse(p);
}

export function OverviewTab() {
  const { project: p, goTab } = useProject();
  const { name } = useUsers();
  const [editing, setEditing] = useState(false);
  const [weather, setWeather] = useState(false);
  const [allActivity, setAllActivity] = useState(false);
  const s = p.stats;
  const today = new Date().toISOString().slice(0, 10);
  const in15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  const overdue = p.items.tasks.filter((t) => isTaskOverdue(t));
  const lateJalons = p.items.jalons.filter((j) => isJalonLate(j));
  const hotRisks = p.items.risks.filter((r) => r.status !== 'clos' && riskScore(r) >= 6);
  const pending = p.items.notes.filter((n) => n.suggestions && hasPending(n.suggestions));
  const upcoming = [
    ...p.items.tasks.filter((t) => !t.done && t.dueDate && t.dueDate >= today && t.dueDate <= in15).map((t) => ({ date: t.dueDate, label: t.title, kind: 'Ticket', who: t.assignee })),
    ...p.items.jalons.filter((j) => !j.done && j.date && j.date >= today && j.date <= in15).map((j) => ({ date: j.date, label: j.label, kind: 'Jalon', who: '' })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const progress = s.openTasks + s.doneTasks ? Math.round((s.doneTasks / (s.openTasks + s.doneTasks)) * 100) : null;
  const budgetRef = p.budgetPrevu ?? null;

  if (editing) return <FicheForm onDone={() => setEditing(false)} />;

  return (
    <div className="overview">
      <div className="overview-main">
        <section className="card">
          <div className="card-head">
            <h2>Fiche projet</h2>
            <button className="btn btn-sm" onClick={() => setEditing(true)}>✏️ Modifier</button>
          </div>
          <dl className="facts">
            <div><dt>{p.chefDeProjetIds.length > 1 ? 'Chefs de projet' : 'Chef de projet'}</dt><dd>{p.chefDeProjetIds.length ? p.chefDeProjetIds.map(name).join(', ') : p.chefDeProjet ? <>{p.chefDeProjet} <span className="muted small">(hors annuaire)</span></> : '—'}</dd></div>
            <div><dt>Suivi par</dt><dd>{p.followers.length ? p.followers.map(name).join(', ') : '—'}</dd></div>
            <div><dt>Demandeur</dt><dd>{p.demandeur || '—'}</dd></div>
            <div><dt>Domaines</dt><dd>{p.domains.length ? p.domains.join(', ') : '—'}</dd></div>
            <div><dt>Début</dt><dd>{p.startDate ? formatDate(p.startDate) : '—'}</dd></div>
            <div><dt>Fin visée</dt><dd>{p.targetDate ? <DueLabel date={p.targetDate} done={p.status === 'termine'} /> : '—'}</dd></div>
          </dl>
          {p.description.trim() ? (
            <MarkdownView markdown={p.description} />
          ) : (
            <p className="muted">Pas encore de description. <button className="btn-link" onClick={() => setEditing(true)}>Décrire le projet</button> : elle servira aussi à générer les cahiers des charges.</p>
          )}
          {p.sections
            .filter((x) => x.content.trim())
            .map((x) => (
              <div key={x.id}>
                <h3>{x.title}</h3>
                <MarkdownView markdown={x.content} />
              </div>
            ))}
        </section>

        {(overdue.length > 0 || lateJalons.length > 0 || hotRisks.length > 0 || pending.length > 0) && (
          <section className="card card-alert">
            <h2>Points d’attention</h2>
            <ul className="alerts">
              {overdue.length > 0 && (
                <li><button className="btn-link" onClick={() => goTab('tickets')}>{overdue.length} ticket{overdue.length > 1 ? 's' : ''} en retard</button> : {overdue.slice(0, 3).map((t) => t.title).join(', ')}{overdue.length > 3 ? '…' : ''}</li>
              )}
              {lateJalons.length > 0 && (
                <li><button className="btn-link" onClick={() => goTab('planning')}>{lateJalons.length} jalon{lateJalons.length > 1 ? 's' : ''} dépassé{lateJalons.length > 1 ? 's' : ''}</button> : {lateJalons.map((j) => j.label).join(', ')}</li>
              )}
              {hotRisks.length > 0 && (
                <li><button className="btn-link" onClick={() => goTab('risques')}>{hotRisks.length} risque{hotRisks.length > 1 ? 's' : ''} critique{hotRisks.length > 1 ? 's' : ''}</button> : {hotRisks.map((r) => r.title).join(', ')}</li>
              )}
              {pending.length > 0 && (
                <li><button className="btn-link" onClick={() => goTab('journal')}>Propositions de l’assistant à valider</button> dans {pending.length} compte{pending.length > 1 ? 's' : ''} rendu{pending.length > 1 ? 's' : ''}</li>
              )}
            </ul>
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <h2>Dans les 15 prochains jours</h2>
            <button className="btn-link small" onClick={() => goTab('planning')}>Planning →</button>
          </div>
          {upcoming.length === 0 ? (
            <p className="muted">Aucune échéance dans les 15 prochains jours.</p>
          ) : (
            <ul className="list-plain">
              {upcoming.map((u, i) => (
                <li key={i} className="upcoming">
                  <DueLabel date={u.date} />
                  <span className="badge">{u.kind}</span>
                  <span>{u.label}</span>
                  {u.who && <span className="muted small">{u.who}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Activité récente</h2>
          <ActivityList entries={allActivity ? p.activity : p.activity.slice(0, 8)} />
          {p.activity.length > 8 && (
            <button className="btn-link small mt" onClick={() => setAllActivity(!allActivity)}>{allActivity ? 'Réduire' : `Voir les ${p.activity.length} dernières actions`}</button>
          )}
        </section>
      </div>

      <aside className="overview-side">
        <section className="card weather" onClick={() => setWeather(true)} role="button" title="Mettre à jour la météo">
          <HealthDot health={p.health} size="lg" />
          <div>
            <div className="strong">{HEALTH_LABELS[p.health]}</div>
            <div className="muted small">{p.healthComment || 'Cliquez pour commenter la météo du projet.'}</div>
          </div>
        </section>

        <section className="card stat-card" onClick={() => goTab('tickets')} role="button">
          <div className="stat-label">Tickets</div>
          <div className="stat-value">{s.openTasks} <span className="muted small">ouvert{s.openTasks > 1 ? 's' : ''}</span></div>
          {progress != null && (
            <>
              <div className="meter"><div style={{ width: `${progress}%` }} /></div>
              <div className="muted small">{progress} % terminés · {s.overdueTasks > 0 ? <span className="due-late">{s.overdueTasks} en retard</span> : 'aucun en retard'}</div>
            </>
          )}
        </section>

        <section className="card stat-card" onClick={() => goTab('planning')} role="button">
          <div className="stat-label">Prochain jalon</div>
          {s.nextJalon ? (
            <>
              <div className="strong">{s.nextJalon.label}</div>
              <DueLabel date={s.nextJalon.date} />
            </>
          ) : (
            <div className="muted">Aucun jalon à venir</div>
          )}
          {s.lateJalons > 0 && <div className="due-late small">{s.lateJalons} jalon{s.lateJalons > 1 ? 's' : ''} en retard</div>}
        </section>

        <section className="card stat-card" onClick={() => goTab('prestations')} role="button">
          <div className="stat-label">Budget</div>
          <div className="stat-value">{euros(s.montantEngage)} <span className="muted small">engagés</span></div>
          <div className="muted small">
            {euros(s.montantPrevu)} prévus en prestations · {days(s.chargeJours)}
            {budgetRef != null && <> · budget {euros(budgetRef)}</>}
          </div>
          {budgetRef != null && budgetRef > 0 && (
            <div className={`meter${s.montantPrevu > budgetRef ? ' meter-danger' : s.montantEngage > budgetRef * 0.8 ? ' meter-warn' : ''}`}>
              <div style={{ width: `${Math.min(100, Math.round((s.montantEngage / budgetRef) * 100))}%` }} />
            </div>
          )}
          {s.prestataires.length > 0 && <div className="small">{s.prestataires.join(', ')}</div>}
        </section>

        <section className="card stat-card" onClick={() => goTab('risques')} role="button">
          <div className="stat-label">Risques ouverts</div>
          <div className="stat-value">{s.openRisks}</div>
          {s.maxRiskScore > 0 && <div className={`small ${s.maxRiskScore >= 6 ? 'due-late' : ''}`}>criticité max. {s.maxRiskScore}/9</div>}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Équipe</h2>
            <button className="btn-link small" onClick={() => goTab('intervenants')}>Tout voir →</button>
          </div>
          {p.items.contacts.length === 0 ? (
            <p className="muted small">Aucun intervenant. <button className="btn-link" onClick={() => goTab('intervenants')}>Ajouter</button></p>
          ) : (
            <ul className="list-plain">
              {p.items.contacts.slice(0, 8).map((c) => (
                <li key={c.id} className="team-row">
                  <span className="avatar">{initials(c.name)}</span>
                  <span>
                    {c.name}
                    <div className="muted small">{[c.role, c.organisation].filter(Boolean).join(' · ')}</div>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
      {weather && <WeatherDialog onClose={() => setWeather(false)} />}
    </div>
  );
}

export function initials(name: string) {
  return name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function ActivityList({ entries, showProject }: { entries: ProjectDetail['activity']; showProject?: boolean }) {
  const navigate = useNavigate();
  const ringHolder = useRingHolder();
  if (!entries.length) return <p className="muted">Aucune activité.</p>;
  return (
    <ul className="activity">
      {entries.map((a, i) => (
        <li key={i}>
          <span className={`avatar avatar-sm${ringClass(ringHolder, a.user)}`}>{initials(shortUser(a.user))}</span>
          <span>
            <strong>{shortUser(a.user)}</strong> {a.text}
            {showProject && (
              <> — <button className="btn-link" onClick={() => navigate(`/projets/${a.projectId}`)}>{a.projectName}</button></>
            )}
            <div className="muted small">{formatDateTime(a.at)}</div>
          </span>
        </li>
      ))}
    </ul>
  );
}

function WeatherDialog({ onClose }: { onClose: () => void }) {
  const { project, setProject } = useProject();
  const [health, setHealth] = useState<Health>(project.health);
  const [comment, setComment] = useState(project.healthComment);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      setProject(await api.updateProject(project.id, project.rev, { ...fieldsOf(project), health, healthComment: comment }));
      toast('Météo mise à jour.');
      onClose();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Météo du projet"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving && <Spinner small />} Enregistrer</button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="health-choices">
        {HEALTHS.map((h) => (
          <button key={h} className={`health-choice${health === h ? ' on' : ''}`} onClick={() => setHealth(h)}>
            <HealthDot health={h} size="lg" />
            {HEALTH_LABELS[h]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Commentaire</span>
        <textarea className="input" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ex. Devis du prestataire toujours en attente, recette décalée d’une semaine" />
      </label>
    </Modal>
  );
}

function FicheForm({ onDone }: { onDone: () => void }) {
  const { project, setProject } = useProject();
  const navigate = useNavigate();
  const [f, setF] = useState<ProjectFields>(() => fieldsOf(project));
  const [tags, setTags] = useState(project.tags.join(', '));
  const { lists } = useSettings();
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ProjectFields>(k: K, v: ProjectFields[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const fields = { ...f, blockedReason: f.blocked ? f.blockedReason : '', tags: [...new Set(tags.split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20) };
      setProject(await api.updateProject(project.id, project.rev, fields));
      toast('Fiche enregistrée.');
      onDone();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }

  async function remove() {
    const typed = prompt(`Supprimer définitivement le projet et tout son contenu (tickets, documents, journal…) ?\nLes cahiers des charges sont conservés.\n\nTapez le nom du projet pour confirmer : ${project.name}`);
    if (typed?.trim() !== project.name.trim()) return;
    try {
      await api.deleteProject(project.id);
      toast('Projet supprimé.');
      navigate('/projets');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Modifier la fiche projet</h2>
      </div>
      <ErrorBox error={error} />
      <div className="form-grid form-grid-4">
        <label className="field span-2">
          <span>Nom *</span>
          <input className="input input-title" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Code</span>
          <input className="input" value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="ex. TC-300" />
        </label>
        <label className="field">
          <span>Étiquettes <span className="muted">(séparées par des virgules)</span></span>
          <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="ex. logistique, ERP" />
        </label>
        <label className="field">
          <span>Statut</span>
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as ProjectFields['status'])}>
            <StatusOptions list="project" current={f.status} />
          </select>
        </label>
        <label className="field">
          <span>Priorité</span>
          <select className="input" value={f.priority} onChange={(e) => set('priority', e.target.value as ProjectFields['priority'])}>
            {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Météo</span>
          <select className="input" value={f.health} onChange={(e) => set('health', e.target.value as Health)}>
            {HEALTHS.map((s) => <option key={s} value={s}>{HEALTH_ICONS[s]} {HEALTH_LABELS[s]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Commentaire météo</span>
          <input className="input" value={f.healthComment} onChange={(e) => set('healthComment', e.target.value)} />
        </label>
        <div className="field span-2">
          <label className="check">
            <input type="checkbox" checked={f.blocked} onChange={(e) => set('blocked', e.target.checked)} /> ⛔ Projet bloqué
          </label>
          {f.blocked && (
            <input className="input" value={f.blockedReason} maxLength={500} onChange={(e) => set('blockedReason', e.target.value)} placeholder="Raison du blocage, ex. En attente de la validation du devis par la direction" aria-label="Raison du blocage" />
          )}
        </div>
        <div className="field span-2">
          <span>Chefs de projet <span className="muted">(un ou plusieurs, ex. un pour l’ERP et un pour le Web)</span></span>
          {!f.chefDeProjetIds.length && f.chefDeProjet && <span className="muted small">Actuellement : {f.chefDeProjet} (hors annuaire)</span>}
          <UserChoices value={f.chefDeProjetIds} onChange={(v) => setF((x) => ({ ...x, chefDeProjetIds: v, chefDeProjet: '' }))} />
        </div>
        <label className="field">
          <span>Demandeur</span>
          <input className="input" value={f.demandeur} onChange={(e) => set('demandeur', e.target.value)} />
        </label>
        <div className="field span-2">
          <span>Domaines</span>
          <DomainChoices value={f.domains} onChange={(v) => set('domains', v)} options={lists.projectDomains} />
        </div>
        <label className="field">
          <span>Date de début</span>
          <input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
        </label>
        <label className="field">
          <span>Date de fin visée</span>
          <input className="input" type="date" value={f.targetDate} onChange={(e) => set('targetDate', e.target.value)} />
        </label>
        <label className="field">
          <span>Budget prévu (€ HT)</span>
          <input
            className="input"
            type="number"
            min={0}
            step={100}
            value={f.budgetPrevu ?? ''}
            onChange={(e) => set('budgetPrevu', e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
      </div>
      <div className="field mt">
        <span>Description <span className="muted">(contexte, besoin, enjeux — reprise pour rédiger les cahiers des charges)</span></span>
        <MarkdownField value={f.description} onChange={(v) => set('description', v)} placeholder="Le contexte du projet, le déclencheur, les enjeux…" />
      </div>
      <SectionsEditor sections={f.sections} onChange={(v) => set('sections', v)} />
      <div className="actions mt">
        <button className="btn btn-danger-ghost" onClick={remove}>Supprimer le projet</button>
        <span className="tb-flex" />
        {conflict ? (
          <button className="btn btn-primary" onClick={() => location.reload()}>Recharger la dernière version</button>
        ) : (
          <>
            <button className="btn" onClick={onDone}>Annuler</button>
            <button className="btn btn-primary" disabled={!f.name.trim() || f.sections.some((x) => !x.title.trim()) || saving} onClick={save}>{saving && <Spinner small />} Enregistrer</button>
          </>
        )}
      </div>
      <p className="muted small">Dernière modification le {formatDateTime(project.updatedAt)} par {shortUser(project.updatedBy)}.</p>
    </section>
  );
}

/** Domaines d'un projet : ceux du paramétrage ; un domaine retiré du paramétrage reste affiché pour pouvoir l'enlever. */
export function DomainChoices({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: string[] }) {
  const all = [...options, ...value.filter((d) => !options.includes(d))];
  return (
    <MultiSelect
      value={value}
      onChange={onChange}
      options={all.map((d) => ({ value: d, label: d, hint: options.includes(d) ? undefined : 'retiré du paramétrage' }))}
      placeholder="Choisir un ou plusieurs domaines…"
      empty="Aucun domaine ne correspond (à ajouter dans le paramétrage)"
    />
  );
}

/** Sections libres sous la description : titre + texte, ajoutées, renommées, déplacées ou retirées par l'utilisateur. */
function SectionsEditor({ sections, onChange }: { sections: ProjectSection[]; onChange: (v: ProjectSection[]) => void }) {
  const update = (id: string, patch: Partial<ProjectSection>) => onChange(sections.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...sections];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  function remove(x: ProjectSection) {
    if (x.content.trim() && !confirm(`Retirer la section « ${x.title || 'sans titre'} » et son texte ?`)) return;
    onChange(sections.filter((y) => y.id !== x.id));
  }
  return (
    <>
      {sections.map((x, i) => (
        <div key={x.id} className="field mt">
          <div className="actions">
            <input className="input strong tb-flex" value={x.title} maxLength={200} onChange={(e) => update(x.id, { title: e.target.value })} placeholder="Titre de la section *" aria-label="Titre de la section" />
            <button className="btn btn-sm" disabled={i === 0} onClick={() => move(i, -1)} title="Monter">↑</button>
            <button className="btn btn-sm" disabled={i === sections.length - 1} onClick={() => move(i, 1)} title="Descendre">↓</button>
            <button className="btn btn-sm btn-danger-ghost" onClick={() => remove(x)} title="Retirer la section">✕</button>
          </div>
          <MarkdownField value={x.content} onChange={(v) => update(x.id, { content: v })} placeholder="Texte de la section…" />
        </div>
      ))}
      {sections.length < 30 && (
        <button className="btn btn-sm mt" onClick={() => onChange([...sections, { id: crypto.randomUUID().slice(0, 8), title: '', content: '' }])}>
          + Ajouter une section
        </button>
      )}
    </>
  );
}
