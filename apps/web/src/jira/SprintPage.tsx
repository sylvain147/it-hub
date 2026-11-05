import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { jiraIssueUrl, movementLabel, shortDay, SPRINT_GROUP_LABELS, type ProjectDetail, type SprintAlert, type SprintDetail } from '@samm/shared';
import { api } from '../api';
import { useJobPolling } from '../hooks';
import { ErrorBox, Spinner, formatDateTime, shortUser, toast } from '../components/ui';
import { MarkdownField, MarkdownView } from '../projects/common';
import { PeopleChart, PointsChart, ProgressChart, ScopeChart, Swatch, TimeChart } from './charts';

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Revue d'un sprint Jira, rattachée à un projet. */
export function SprintPage() {
  const { id = '', sprintId = '' } = useParams();
  const sid = Number(sprintId);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [d, setD] = useState<SprintDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api.getProject(id), api.getSprint(sid)]);
      setProject(p);
      setD(s);
      setJobId(s.activeJobId);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [id, sid]);
  useEffect(() => {
    void load();
  }, [load]);

  const job = useJobPolling(jobId, async (j) => {
    setJobId(null);
    if (j.status === 'termine') toast(`${j.step}.`);
    else toast(j.error, 'error');
    await load();
  });

  async function sync() {
    if (!project?.jiraBoardId) return;
    setSyncing(true);
    try {
      setD(await api.syncSprint(sid, project.jiraBoardId, project.jiraProjectKey));
      toast('Données actualisées depuis Jira.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  }

  if (error) return <div className="page"><ErrorBox error={error} /><Link to={`/projets/${id}?onglet=sprints`}>← Sprints du projet</Link></div>;
  if (!d || !project) return <div className="page"><Spinner /></div>;
  const r = d.report;
  const c = r.counts;
  const issueLink = (key: string) => {
    const url = jiraIssueUrl(d.site, key);
    return url ? <a href={url} target="_blank" rel="noreferrer" className="mono strong-link">{key}</a> : <span className="mono">{key}</span>;
  };
  const recette = r.issues.filter((i) => i.active && i.group === 'recette');
  const waitShare = r.timeByGroup.find((t) => t.group === 'attente')?.share ?? 0;

  return (
    <div className="page page-wide sprint-page">
      <Link to={`/projets/${project.id}?onglet=sprints`} className="muted small no-print">← {project.name} · Sprints</Link>
      <div className="project-head">
        <div>
          <div className="eyebrow">Revue de sprint · {project.jiraProjectKey || project.name}</div>
          <h1>{r.sprint.name} — Synthèse</h1>
          <div className="muted small">
            Lancé le {shortDay(r.startDay)}
            {r.endDay && ` · fin prévue le ${shortDay(r.endDay)}`} · données arrêtées au {shortDay(r.asOfDay)}
            {r.sprint.state === 'closed' ? ' (sprint clos)' : ''} · {c.total} tickets, {c.active} actifs
          </div>
          {r.sprint.goal && <div className="small mt">🎯 {r.sprint.goal}</div>}
          {r.team.length > 0 && <div className="muted small">Équipe : {r.team.join(' · ')}</div>}
        </div>
        <div className="row-actions no-print">
          <button className="btn" onClick={() => void sync()} disabled={syncing || !!jobId}>
            {syncing && <Spinner small />} Actualiser depuis Jira
          </button>
          <button className="btn" onClick={() => window.print()}>Imprimer / PDF</button>
        </div>
      </div>
      <p className="muted small no-print">
        Données récupérées le {formatDateTime(d.syncedAt)} par {shortUser(d.syncedBy)}. Tous les chiffres sont calculés à partir de l’historique Jira des tickets.
      </p>

      <div className="stats-row">
        <div className="stat">
          <div className="stat-label">Tickets actifs</div>
          <div className="stat-value">{c.active}</div>
          <span className="small muted">{c.total} passés par le sprint, {c.removed} retiré{c.removed > 1 ? 's' : ''}</span>
        </div>
        <div className="stat">
          <div className="stat-label">Tickets clôturés</div>
          <div className="stat-value">{c.done} <span className="stat-of">/ {c.active}</span></div>
          <span className="small muted">{c.done + c.recette} / {c.active} ({pct(c.done + c.recette, c.active)} %) en comptant la recette</span>
        </div>
        <div className="stat">
          <div className="stat-label">Story points livrés</div>
          <div className="stat-value">{fmt(r.points.done)} <span className="stat-of">/ {fmt(r.points.active)} SP</span></div>
          <span className="small muted">renseignés sur {c.withPoints} ticket{c.withPoints > 1 ? 's' : ''} actif{c.withPoints > 1 ? 's' : ''} sur {c.active}</span>
        </div>
        <div className={c.added ? 'stat stat-attn' : 'stat'}>
          <div className="stat-label">Ajouts en cours de sprint</div>
          <div className="stat-value">+{c.added}</div>
          <span className="small muted">{c.added ? (c.addedDone ? `${c.addedDone} clôturé${c.addedDone > 1 ? 's' : ''}` : 'aucun clôturé à ce jour') : 'périmètre stable'}</span>
        </div>
        <div className={c.overdue ? 'stat stat-crit' : 'stat'}>
          <div className="stat-label">Échéances dépassées</div>
          <div className="stat-value">{c.overdue}</div>
          <span className="small muted">{r.issues.filter((i) => i.overdue).map((i) => i.key).join(', ') || 'aucune'}</span>
        </div>
      </div>

      <CompteRendu d={d} sid={sid} projectId={project.id} jobId={jobId} jobStep={job?.step ?? null} onJob={setJobId} onSaved={setD} />

      <div className="grid-3">
        <section className="card">
          <h2>Avancement des tickets actifs</h2>
          <p className="muted small">Répartition par statut · {c.active} tickets</p>
          <ProgressChart r={r} />
        </section>
        <section className="card">
          <h2>Charge par personne</h2>
          <p className="muted small">Tickets actifs par personne et par statut</p>
          <PeopleChart r={r} />
        </section>
        <section className="card">
          <h2>Story points</h2>
          <p className="muted small">Par statut{r.points.removed ? ` · ${fmt(r.points.removed)} SP sortis du sprint` : ''}</p>
          <PointsChart r={r} />
        </section>
      </div>

      <div className="grid-wide">
        <section className="card">
          <h2>Périmètre et clôtures</h2>
          <p className="muted small">Tickets actifs dans le sprint et tickets clôturés, du {shortDay(r.startDay)} au {shortDay(r.asOfDay)}</p>
          <ScopeChart r={r} />
        </section>
        <section className="card">
          <h2>Où passe le temps ?</h2>
          <p className="muted small">Part du temps des tickets par statut pendant le sprint (hors clôturés)</p>
          <TimeChart r={r} />
          <div className="facts-grid mt">
            {r.medianCloseDays !== null && (
              <div><strong>≈ {fmt(r.medianCloseDays)} j</strong><span className="small muted">délai médian de clôture ({r.closeDaysRange![0]} à {r.closeDaysRange![1]} j)</span></div>
            )}
            <div><strong>{waitShare} %</strong><span className="small muted">du temps en attente</span></div>
            <div><strong>{recette.length}</strong><span className="small muted">en recette{recette.length ? ` (${recette.map((i) => i.key).join(', ')})` : ''}</span></div>
            <div><strong>{c.removed}</strong><span className="small muted">sorti{c.removed > 1 ? 's' : ''} du sprint</span></div>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Les {c.total} tickets du sprint</h2>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Clé</th>
                <th>Résumé</th>
                <th>Assigné</th>
                <th>Priorité</th>
                <th className="num">SP</th>
                <th>Statut</th>
                <th>Mouvement</th>
                <th>Échéance</th>
                <th>Desk</th>
              </tr>
            </thead>
            <tbody>
              {r.issues.map((i) => {
                const desk = i.deskRef ? d.desk[i.deskRef] : undefined;
                return (
                  <tr key={i.key} className={i.active ? '' : 'row-done'}>
                    <td className="nowrap">{issueLink(i.key)}</td>
                    <td>{i.summary}</td>
                    <td className="nowrap small">{i.assignee}</td>
                    <td className={/high|haute|critique|highest|urgent/i.test(i.priority) ? 'small danger-text' : 'small muted'}>{i.priority}</td>
                    <td className="num">{i.points === null ? '–' : fmt(i.points)}</td>
                    <td className="nowrap">
                      <span className="status-chip" title={SPRINT_GROUP_LABELS[i.group]}><Swatch group={i.group} /> {i.status}</span>
                    </td>
                    <td className="small">{movementLabel(i.movement)}</td>
                    <td className={i.overdue ? 'nowrap danger-text strong' : 'nowrap small'}>{i.dueDate ? shortDay(i.dueDate) : '–'}</td>
                    <td className="small nowrap">
                      {i.deskRef ? (
                        <span title={desk ? `${desk.subject} — ${desk.status}${desk.theme ? ` · ${desk.theme}` : ''}` : 'Ticket absent des exports Desk importés dans le suivi TMA'}>
                          #{i.deskRef}{desk ? ' ✓' : ''}
                        </span>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {r.issues.some((i) => i.deskRef) && (
          <p className="muted small">Desk : numéro du ticket de support cité par le ticket Jira ; ✓ = connu du suivi TMA (survolez pour voir son sujet).</p>
        )}
      </section>

      <div className="grid-halves">
        <AlertList title="Risques et points d’attention" alerts={r.attention} empty="Rien à signaler." />
        <AlertList title="Qualité des données Jira" alerts={r.dataQuality} empty="Pas de défaut de saisie détecté." />
      </div>
    </div>
  );
}

function AlertList({ title, alerts, empty }: { title: string; alerts: SprintAlert[]; empty: string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {!alerts.length && <p className="muted small">{empty}</p>}
      <div className="sprint-alerts">
        {alerts.map((a, i) => (
          <div key={i} className={`sprint-alert sprint-alert-${a.level}`}>
            <strong>{a.level === 'critique' ? '⛔ ' : a.level === 'attention' ? '⚠️ ' : 'ℹ️ '}{a.title}</strong>
            <div className="small">{a.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CompteRendu({
  d,
  sid,
  projectId,
  jobId,
  jobStep,
  onJob,
  onSaved,
}: {
  d: SprintDetail;
  sid: number;
  projectId: string;
  jobId: string | null;
  jobStep: string | null;
  onJob: (id: string) => void;
  onSaved: (d: SprintDetail) => void;
}) {
  const cr = d.compteRendu;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  async function write() {
    if (cr && !confirm('Rédiger un nouveau compte rendu ? Le compte rendu actuel (et vos modifications) sera remplacé.')) return;
    try {
      onJob((await api.writeSprintReview(sid)).id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function save() {
    setBusy(true);
    try {
      onSaved(await api.saveSprintReview(sid, draft));
      setEditing(false);
      toast('Compte rendu enregistré.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      await api.publishSprintReview(sid, projectId);
      toast('Compte rendu ajouté au journal du projet.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Compte rendu</h2>
        <div className="row-actions no-print">
          {cr && !editing && (
            <>
              <button className="btn btn-sm" disabled={!!jobId || busy} onClick={() => { setDraft(cr.markdown); setEditing(true); }}>Modifier</button>
              <button className="btn btn-sm" disabled={!!jobId || busy} onClick={() => void publish()}>Ajouter au journal du projet</button>
            </>
          )}
          {!editing && (
            <button className="btn btn-ai" disabled={!!jobId} onClick={() => void write()}>
              {jobId ? <Spinner small /> : '✨'} {cr ? 'Rédiger à nouveau' : 'Rédiger le compte rendu'}
            </button>
          )}
        </div>
      </div>
      {jobId ? (
        <div className="alert alert-info"><Spinner small /> {jobStep ?? 'Rédaction en cours…'}</div>
      ) : editing ? (
        <>
          <MarkdownField value={draft} onChange={setDraft} resetKey={cr?.createdAt} />
          <div className="actions mt">
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy && <Spinner small />} Enregistrer</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </>
      ) : cr ? (
        <>
          <MarkdownView markdown={cr.markdown} />
          <p className="muted small">
            Rédigé par l’assistant le {formatDateTime(cr.createdAt)} à la demande de {shortUser(cr.createdBy)}
            {cr.editedAt && `, modifié le ${formatDateTime(cr.editedAt)} par ${shortUser(cr.editedBy ?? '')}`}.
            {cr.createdAt < d.syncedAt && ' Les données ont été actualisées depuis : rédigez à nouveau pour en tenir compte.'}
          </p>
        </>
      ) : (
        <p className="muted small">
          L’assistant rédige le message clé, les faits marquants, les risques et des pistes pour le prochain sprint à partir des seuls chiffres de cette page (ni
          descriptions ni commentaires de tickets). Vous pourrez le modifier, puis l’ajouter au journal du projet.
        </p>
      )}
    </section>
  );
}
