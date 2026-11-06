import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  jiraIssueUrl,
  movementLabel,
  shortDay,
  sprintDocKinds,
  SPRINT_DOC_LABELS,
  SPRINT_GROUP_LABELS,
  type SprintAlert,
  type SprintDetail,
  type SprintDocKind,
  type SprintPromptExport,
  type SprintPreparation,
  type SprintReport,
} from '@samm/shared';
import { api, download } from '../api';
import { useJobPolling } from '../hooks';
import { ErrorBox, Modal, Spinner, formatDateTime, shortUser, toast } from '../components/ui';
import { MarkdownField, MarkdownView } from '../projects/common';
import { PeopleChart, PointsChart, ProgressChart, ScopeChart, Swatch, TimeChart } from './charts';
import { SprintStateBadge } from './JiraPage';

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Sprint Jira : revue chiffrée (sprint démarré) ou préparation (sprint à venir ou en cours), et documents rédigés par l'IA. */
export function SprintPage() {
  const { sprintId = '' } = useParams();
  const sid = Number(sprintId);
  const [d, setD] = useState<SprintDetail | null>(null);
  const [view, setView] = useState<SprintDocKind | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api.getSprint(sid);
      setD(s);
      setJobId(s.activeJobId);
      setView((v) => v ?? sprintDocKinds(s.report?.sprint.state ?? s.preparation?.sprint.state ?? 'closed')[0]!);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [sid]);
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
    setSyncing(true);
    try {
      await api.importJira();
      await load();
      toast('Données actualisées depuis Jira.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  }

  if (error) return <div className="page"><ErrorBox error={error} /><Link to="/jira">← Jira</Link></div>;
  if (!d || !view) return <div className="page"><Spinner /></div>;
  const sprint = (d.report ?? d.preparation)!.sprint;
  const kinds = sprintDocKinds(sprint.state);
  const r = d.report;
  const p = d.preparation;

  return (
    <div className="page page-wide sprint-page">
      <Link to="/jira" className="muted small no-print">← Jira · Sprints</Link>
      <div className="project-head">
        <div>
          <div className="eyebrow">{view === 'preparation' ? 'Préparation de sprint' : 'Revue de sprint'}{d.boardName && ` · ${d.boardName}`}</div>
          <h1>{sprint.name} <SprintStateBadge state={sprint.state} /></h1>
          <div className="muted small">
            {r ? (
              <>
                Lancé le {shortDay(r.startDay)}
                {r.endDay && ` · fin prévue le ${shortDay(r.endDay)}`} · données arrêtées au {shortDay(r.asOfDay)}
                {sprint.state === 'closed' ? ' (sprint clos)' : ''} · {r.counts.total} tickets, {r.counts.active} actifs
              </>
            ) : (
              <>
                {p?.startDay ? `Début le ${shortDay(p.startDay)}` : 'Début non fixé'}
                {p?.endDay ? ` · fin le ${shortDay(p.endDay)}` : ''} · {p?.totals.count ?? 0} tickets prévus
              </>
            )}
          </div>
          {sprint.goal && <div className="small mt">🎯 {sprint.goal}</div>}
          {r && r.team.length > 0 && <div className="muted small">Équipe : {r.team.join(' · ')}</div>}
        </div>
        <div className="row-actions no-print">
          {kinds.length > 1 && (
            <div className="seg">
              {kinds.map((k) => (
                <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{k === 'compte_rendu' ? 'Revue' : 'Préparation'}</button>
              ))}
            </div>
          )}
          <button className="btn" onClick={() => void sync()} disabled={syncing || !!jobId}>
            {syncing && <Spinner small />} Actualiser depuis Jira
          </button>
          <button className="btn" onClick={() => window.print()}>Imprimer / PDF</button>
        </div>
      </div>
      <p className="muted small no-print">
        Données récupérées le {formatDateTime(d.syncedAt)} par {shortUser(d.syncedBy)}. Tous les chiffres sont calculés à partir des tickets Jira et de leur historique.
      </p>

      <SprintDocCard key={view} d={d} sid={sid} kind={view} jobId={jobId} jobStep={job?.step ?? null} onJob={setJobId} onSaved={setD} />

      {view === 'compte_rendu' && r && <ReviewView d={d} r={r} />}
      {view === 'preparation' && p && <PreparationView d={d} p={p} />}
    </div>
  );
}

function ReviewView({ d, r }: { d: SprintDetail; r: SprintReport }) {
  const c = r.counts;
  const issueLink = (key: string) => {
    const url = jiraIssueUrl(d.site, key);
    return url ? <a href={url} target="_blank" rel="noreferrer" className="mono strong-link">{key}</a> : <span className="mono">{key}</span>;
  };
  const recette = r.issues.filter((i) => i.active && i.group === 'recette');
  const waitShare = r.timeByGroup.find((t) => t.group === 'attente')?.share ?? 0;
  return (
    <>
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
    </>
  );
}

function PreparationView({ d, p }: { d: SprintDetail; p: SprintPreparation }) {
  const t = p.totals;
  const issueLink = (key: string) => {
    const url = jiraIssueUrl(d.site, key);
    return url ? <a href={url} target="_blank" rel="noreferrer" className="mono strong-link">{key}</a> : <span className="mono">{key}</span>;
  };
  const over = p.velocity.points !== null && t.points > p.velocity.points * 1.15;
  const table = (rows: SprintPreparation['planned'], empty: string) =>
    !rows.length ? (
      <p className="muted small">{empty}</p>
    ) : (
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
              <th>Échéance</th>
              <th>Projet</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.key} className={i.group === 'termine' ? 'row-done' : ''}>
                <td className="nowrap">{issueLink(i.key)}</td>
                <td>
                  {i.summary}
                  {i.parent && <div className="muted small">↳ {i.parent}</div>}
                </td>
                <td className={i.assignee === 'Non assigné' ? 'nowrap small danger-text' : 'nowrap small'}>{i.assignee}</td>
                <td className={/high|haute|critique|highest|urgent/i.test(i.priority) ? 'small danger-text' : 'small muted'}>{i.priority}</td>
                <td className={i.points === null ? 'num muted' : 'num'}>{i.points === null ? '?' : fmt(i.points)}</td>
                <td className="nowrap">
                  <span className="status-chip" title={SPRINT_GROUP_LABELS[i.group]}><Swatch group={i.group} /> {i.status}</span>
                </td>
                <td className="nowrap small">{i.dueDate ? shortDay(i.dueDate) : '–'}</td>
                <td className="small">{i.project || <span className="muted">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <>
      <div className="stats-row">
        <div className="stat">
          <div className="stat-label">Tickets prévus</div>
          <div className="stat-value">{t.open}</div>
          <span className="small muted">{t.count - t.open ? `${t.count - t.open} déjà terminé(s)` : 'à traiter dans le sprint'}</span>
        </div>
        <div className={over ? 'stat stat-attn' : 'stat'}>
          <div className="stat-label">Story points prévus</div>
          <div className="stat-value">{fmt(t.points)} <span className="stat-of">SP</span></div>
          <span className="small muted">{p.velocity.points !== null ? `vélocité moyenne : ${fmt(p.velocity.points)} SP` : 'vélocité inconnue (aucun sprint clos importé)'}</span>
        </div>
        <div className={t.unestimated ? 'stat stat-attn' : 'stat'}>
          <div className="stat-label">Sans estimation</div>
          <div className="stat-value">{t.unestimated}</div>
          <span className="small muted">estimés : {t.withPoints} / {t.open}</span>
        </div>
        <div className={t.unassigned ? 'stat stat-crit' : 'stat'}>
          <div className="stat-label">Sans responsable</div>
          <div className="stat-value">{t.unassigned}</div>
          <span className="small muted">{t.unassigned ? 'à attribuer avant le lancement' : 'tous attribués'}</span>
        </div>
        <div className="stat">
          <div className="stat-label">Reports probables</div>
          <div className="stat-value">{p.carryOver.length}</div>
          <span className="small muted">{p.carryOverFrom ? `non terminés au ${p.carryOverFrom}` : 'pas de sprint en cours'}</span>
        </div>
      </div>

      <div className="grid-wide">
        <section className="card">
          <h2>Tickets prévus</h2>
          {table(p.planned, 'Aucun ticket n’est encore prévu dans ce sprint.')}
        </section>
        <section className="card">
          <h2>Charge et vélocité</h2>
          <div className="table-wrap">
            <table className="table table-compact table-scroll">
              <thead>
                <tr><th>Personne</th><th className="num">Tickets</th><th className="num">SP</th></tr>
              </thead>
              <tbody>
                {p.byAssignee.map((a) => (
                  <tr key={a.assignee}><td className={a.assignee === 'Non assigné' ? 'danger-text' : ''}>{a.assignee}</td><td className="num">{a.count}</td><td className="num">{fmt(a.points)}</td></tr>
                ))}
                {!p.byAssignee.length && <tr><td colSpan={3} className="muted">—</td></tr>}
              </tbody>
            </table>
          </div>
          <h3 className="mt">Derniers sprints</h3>
          {p.history.length ? (
            <ul className="list-plain small">
              {p.history.map((h) => (
                <li key={h.name}>{h.name} : <strong>{fmt(h.points)} SP</strong> livrés, {h.done} ticket{h.done > 1 ? 's' : ''} clôturé{h.done > 1 ? 's' : ''} sur {h.active}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Aucun sprint clos importé pour ce tableau.</p>
          )}
        </section>
      </div>

      <div className="grid-halves">
        {p.carryOverFrom && (
          <section className="card">
            <h2>Non terminés au {p.carryOverFrom}</h2>
            <p className="muted small">Reports probables : à intégrer au sprint ou à replanifier.</p>
            {table(p.carryOver, 'Aucun ticket ouvert dans le sprint en cours.')}
          </section>
        )}
        <section className="card">
          <h2>Backlog prioritaire</h2>
          <p className="muted small">Les {p.backlog.length} tickets les plus prioritaires sur {p.backlogTotal} ouverts hors sprint.</p>
          {table(p.backlog, 'Backlog vide.')}
        </section>
      </div>

      <AlertList title="Points à clarifier" alerts={p.alerts} empty="Rien à signaler." />
    </>
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

/** Document de sprint rédigé par l'IA : compte rendu ou préparation. */
function SprintDocCard({
  d,
  sid,
  kind,
  jobId,
  jobStep,
  onJob,
  onSaved,
}: {
  d: SprintDetail;
  sid: number;
  kind: SprintDocKind;
  jobId: string | null;
  jobStep: string | null;
  onJob: (id: string) => void;
  onSaved: (d: SprintDetail) => void;
}) {
  const doc = d.documents[kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState(d.projects[0]?.id ?? '');
  const projects = useProjectsList();
  const label = SPRINT_DOC_LABELS[kind];
  const review = kind === 'compte_rendu';
  const [exporting, setExporting] = useState(false);

  async function write() {
    if (doc && !confirm(`Rédiger à nouveau ? Le document actuel (et vos modifications) sera remplacé.`)) return;
    try {
      onJob((await api.writeSprintDoc(sid, kind)).id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      {exporting && <PromptExportModal sid={sid} kind={kind} onClose={() => setExporting(false)} onSaved={onSaved} />}
      <div className="card-head">
        <h2>{label}</h2>
        <div className="row-actions no-print">
          {doc && !editing && (
            <>
              <button className="btn btn-sm" disabled={!!jobId || busy} onClick={() => { setDraft(doc.markdown); setEditing(true); }}>Modifier</button>
              <button className="btn btn-sm" disabled={!!jobId || busy} onClick={() => void act(async () => { const f = await api.sprintDocWord(sid, kind); download(f.url, f.fileName); })}>
                ⬇ Word
              </button>
            </>
          )}
          {!editing && (
            <button className="btn btn-ghost btn-sm" disabled={!!jobId} onClick={() => setExporting(true)} title="Tests : requête exacte qui serait envoyée à Bedrock, sans appel au modèle">
              Exporter le prompt
            </button>
          )}
          {!editing && (
            <button className="btn btn-ai" disabled={!!jobId} onClick={() => void write()}>
              {jobId ? <Spinner small /> : '✨'} {doc ? 'Rédiger à nouveau' : review ? 'Rédiger le compte rendu' : 'Rédiger la préparation'}
            </button>
          )}
        </div>
      </div>
      {jobId ? (
        <div className="alert alert-info"><Spinner small /> {jobStep ?? 'Rédaction en cours…'}</div>
      ) : editing ? (
        <>
          <MarkdownField value={draft} onChange={setDraft} resetKey={doc?.createdAt} />
          <div className="actions mt">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  onSaved(await api.saveSprintDoc(sid, kind, draft));
                  setEditing(false);
                  toast('Document enregistré.');
                })
              }
            >
              {busy && <Spinner small />} Enregistrer
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(false)}>Annuler</button>
          </div>
        </>
      ) : doc ? (
        <>
          <MarkdownView markdown={doc.markdown} />
          <p className="muted small">
            Rédigé par l’assistant le {formatDateTime(doc.createdAt)} à la demande de {shortUser(doc.createdBy)}
            {doc.editedAt && `, modifié le ${formatDateTime(doc.editedAt)} par ${shortUser(doc.editedBy ?? '')}`}.
            {doc.createdAt < d.syncedAt && ' Les données ont été actualisées depuis : rédigez à nouveau pour en tenir compte.'}
          </p>
          <div className="toolbar-row no-print">
            <span className="small">Ajouter au journal du projet</span>
            <select className="input input-auto" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet">
              <option value="">Choisir un projet…</option>
              {d.projects.length > 0 && (
                <optgroup label="Projets reliés aux tickets du sprint">
                  {d.projects.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.count})</option>)}
                </optgroup>
              )}
              <optgroup label="Autres projets">
                {projects.filter((x) => !d.projects.some((y) => y.id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </optgroup>
            </select>
            <button
              className="btn btn-sm"
              disabled={!projectId || busy || !!jobId}
              onClick={() =>
                void act(async () => {
                  await api.publishSprintDoc(sid, kind, projectId);
                  toast('Document ajouté au journal du projet.');
                })
              }
            >
              Ajouter
            </button>
          </div>
        </>
      ) : (
        <p className="muted small">
          {review
            ? 'L’assistant rédige le message clé, les faits marquants, les risques et des pistes pour le prochain sprint à partir des seuls chiffres de cette page.'
            : 'L’assistant propose un objectif, compare le périmètre prévu à la vélocité, arbitre reports et candidats du backlog, liste les points à clarifier et l’ordre du jour de la réunion de planification.'}{' '}
          Ni descriptions ni commentaires de tickets ne lui sont envoyés. Vous pourrez modifier le document, le télécharger au format Word et l’ajouter au journal d’un projet.
        </p>
      )}
    </section>
  );
}

/**
 * Tests : requête qui serait envoyée à Bedrock (texte pour une IA locale, ou corps JSON exact), et collage de la
 * réponse obtenue pour l'enregistrer comme document.
 */
function PromptExportModal({ sid, kind, onClose, onSaved }: { sid: number; kind: SprintDocKind; onClose: () => void; onSaved: (d: SprintDetail) => void }) {
  const [data, setData] = useState<SprintPromptExport | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'texte' | 'json'>('texte');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.sprintDocPrompt(sid, kind).then(setData, setError);
  }, [sid, kind]);

  const content = !data ? '' : tab === 'texte' ? data.text : JSON.stringify(data.body, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      toast('Copié dans le presse-papiers.');
    } catch {
      toast('Copie impossible : sélectionnez le texte à la main.', 'error');
    }
  }

  function save() {
    const blob = new Blob([content], { type: tab === 'texte' ? 'text/plain;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob);
    download(url, `prompt-${kind}-sprint-${sid}.${tab === 'texte' ? 'txt' : 'json'}`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function useAnswer() {
    setBusy(true);
    try {
      onSaved(await api.saveSprintDoc(sid, kind, markdownOfAnswer(answer)));
      toast('Réponse enregistrée comme document.');
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Exporter le prompt — ${SPRINT_DOC_LABELS[kind]}`} onClose={onClose} wide>
      <p className="muted small">
        Requête que le hub enverrait à Bedrock, produite par le même code que l’appel réel mais interceptée avant l’envoi : aucun appel au modèle, aucun coût.
      </p>
      <ErrorBox error={error} />
      {!data && !error && <Spinner />}
      {data && (
        <>
          <div className="toolbar-row">
            <div className="seg">
              <button className={tab === 'texte' ? 'on' : ''} onClick={() => setTab('texte')}>Prompt (texte)</button>
              <button className={tab === 'json' ? 'on' : ''} onClick={() => setTab('json')}>Requête Bedrock (JSON exact)</button>
            </div>
            <span className="tb-flex" />
            <button className="btn btn-sm" onClick={() => void copy()}>Copier</button>
            <button className="btn btn-sm" onClick={save}>⬇ Télécharger</button>
          </div>
          <p className="muted small">
            {tab === 'texte'
              ? 'Instructions système puis message, dans l’ordre où le modèle les reçoit ; le schéma de réponse (imposé par Bedrock hors texte) est ajouté à la fin pour votre IA locale.'
              : `POST ${data.url} — corps envoyé tel quel (modèle ${data.model}).`}
          </p>
          <pre className="notes prompt-export">{content}</pre>
          <h3 className="mt">Réponse de votre IA</h3>
          <p className="muted small">Collez la réponse (le JSON {'{"markdown": "…"}'} ou directement le Markdown) pour l’enregistrer comme document de ce sprint.</p>
          <textarea className="input" rows={6} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="actions mt">
            <button className="btn btn-primary" disabled={busy || !answer.trim()} onClick={() => void useAnswer()}>{busy && <Spinner small />} Enregistrer comme document</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Réponse collée : objet JSON `{ markdown }` (éventuellement entre ```json … ```), sinon Markdown brut. */
function markdownOfAnswer(raw: string): string {
  const t = raw.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
  try {
    const j = JSON.parse(t) as { markdown?: unknown };
    if (typeof j.markdown === 'string') return j.markdown.trim();
  } catch {
    /* Markdown brut */
  }
  return raw.trim();
}

function useProjectsList() {
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    api.listProjects().then((ps) => setList(ps.filter((p) => !['termine', 'abandonne'].includes(p.status)).map((p) => ({ id: p.id, name: p.name }))), () => {});
  }, []);
  return list;
}
