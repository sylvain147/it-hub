import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  movementLabel,
  shortDay,
  sprintDocKinds,
  SPRINT_DOC_LABELS,
  type PreparationIssue,
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
import { PeopleChart, ProgressChart, ScopeChart, TimeChart, useTicketLabel } from './charts';
import { SprintStateBadge, sprintDates } from './SprintsPage';
import { TicketStatusChip } from './tickets';

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Sprint : revue chiffrée (sprint démarré) ou préparation (sprint à venir ou en cours), et documents rédigés par l'IA. */
export function SprintPage() {
  const { sprintId = '' } = useParams();
  const sid = Number(sprintId);
  const [d, setD] = useState<SprintDetail | null>(null);
  const [view, setView] = useState<SprintDocKind | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getSprint(sid);
      setD(s);
      setJobId(s.activeJobId);
      setView((v) => v ?? sprintDocKinds(s.sprint.state)[0]!);
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

  if (error) return <div className="page"><ErrorBox error={error} /><Link to="/sprints">← Sprints</Link></div>;
  if (!d || !view) return <div className="page"><Spinner /></div>;
  const sprint = d.sprint;
  const kinds = sprintDocKinds(sprint.state);
  const r = d.report;
  const p = d.preparation;

  return (
    <div className="page page-wide sprint-page">
      <Link to="/sprints" className="muted small no-print">← Sprints</Link>
      <div className="project-head">
        <div>
          <div className="eyebrow">{view === 'preparation' ? 'Préparation de sprint' : 'Revue de sprint'}</div>
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
                {sprintDates(sprint)} · {p?.totals.count ?? 0} tickets prévus
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
          <button className="btn" onClick={() => void load()} disabled={!!jobId}>⟳ Actualiser</button>
          <button className="btn" onClick={() => window.print()}>Imprimer / PDF</button>
        </div>
      </div>
      <p className="muted small no-print">Tous les chiffres sont calculés à partir des tickets et de l’historique de leurs statuts et de leurs sprints.</p>

      <SprintDocCard key={view} d={d} sid={sid} kind={view} jobId={jobId} jobStep={job?.step ?? null} onJob={setJobId} onSaved={setD} />

      {view === 'compte_rendu' && r && <ReviewView r={r} />}
      {view === 'preparation' && p && <PreparationView p={p} />}
    </div>
  );
}

function ProjectLink({ id, name }: { id: string; name: string }) {
  return name ? <Link to={`/projets/${id}?onglet=tickets`} className="small">{name}</Link> : <span className="muted">–</span>;
}

function ReviewView({ r }: { r: SprintReport }) {
  const label = useTicketLabel();
  const c = r.counts;
  const recette = r.issues.filter((i) => i.active && i.status === 'recette');
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
          <div className="stat-label">Tickets terminés</div>
          <div className="stat-value">{c.done} <span className="stat-of">/ {c.active}</span></div>
          <span className="small muted">{c.done + c.recette} / {c.active} ({pct(c.done + c.recette, c.active)} %) en comptant « {label('recette').toLowerCase()} »</span>
        </div>
        <div className={c.added ? 'stat stat-attn' : 'stat'}>
          <div className="stat-label">Ajouts en cours de sprint</div>
          <div className="stat-value">+{c.added}</div>
          <span className="small muted">{c.added ? (c.addedDone ? `${c.addedDone} terminé${c.addedDone > 1 ? 's' : ''}` : 'aucun terminé à ce jour') : 'périmètre stable'}</span>
        </div>
        <div className={c.overdue ? 'stat stat-crit' : 'stat'}>
          <div className="stat-label">Échéances dépassées</div>
          <div className="stat-value">{c.overdue}</div>
          <span className="small muted">{r.issues.filter((i) => i.overdue).map((i) => i.key).join(', ') || 'aucune'}</span>
        </div>
      </div>

      <div className="grid-halves">
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
      </div>

      <div className="grid-wide">
        <section className="card">
          <h2>Périmètre et clôtures</h2>
          <p className="muted small">Tickets actifs dans le sprint et tickets terminés, du {shortDay(r.startDay)} au {shortDay(r.asOfDay)}</p>
          <ScopeChart r={r} />
        </section>
        <section className="card">
          <h2>Où passe le temps ?</h2>
          <p className="muted small">Part du temps des tickets par statut pendant le sprint (hors terminés)</p>
          <TimeChart r={r} />
          <div className="facts-grid mt">
            {r.medianCloseDays !== null && (
              <div><strong>≈ {fmt(r.medianCloseDays)} j</strong><span className="small muted">délai médian de clôture ({r.closeDaysRange![0]} à {r.closeDaysRange![1]} j)</span></div>
            )}
            <div><strong>{waitShare} %</strong><span className="small muted">du temps « {label('attente').toLowerCase()} »</span></div>
            <div><strong>{recette.length}</strong><span className="small muted">« {label('recette').toLowerCase()} »{recette.length ? ` (${recette.map((i) => i.key).join(', ')})` : ''}</span></div>
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
                <th>Intitulé</th>
                <th>Projet</th>
                <th>Responsable</th>
                <th>Statut</th>
                <th>Mouvement</th>
                <th>Échéance</th>
              </tr>
            </thead>
            <tbody>
              {r.issues.map((i) => (
                <tr key={i.id} className={i.active ? '' : 'row-done'}>
                  <td className="nowrap ticket-key">{i.key}</td>
                  <td>{i.summary}</td>
                  <td><ProjectLink id={i.projectId} name={i.project} /></td>
                  <td className="nowrap small">{i.assignee}</td>
                  <td className="nowrap"><TicketStatusChip status={i.status} /></td>
                  <td className="small">{movementLabel(i.movement)}</td>
                  <td className={i.overdue ? 'nowrap danger-text strong' : 'nowrap small'}>{i.dueDate ? shortDay(i.dueDate) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <AlertList title="Risques et points d’attention" alerts={r.attention} empty="Rien à signaler." />
    </>
  );
}

function PreparationView({ p }: { p: SprintPreparation }) {
  const t = p.totals;
  const over = p.velocity !== null && t.open > p.velocity * 1.3;
  const table = (rows: PreparationIssue[], empty: string) =>
    !rows.length ? (
      <p className="muted small">{empty}</p>
    ) : (
      <div className="table-wrap">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Clé</th>
              <th>Intitulé</th>
              <th>Projet</th>
              <th>Responsable</th>
              <th>Statut</th>
              <th>Échéance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className={i.status === 'termine' ? 'row-done' : ''}>
                <td className="nowrap ticket-key">{i.key}</td>
                <td>{i.summary}</td>
                <td><ProjectLink id={i.projectId} name={i.project} /></td>
                <td className={i.assignee === 'Non assigné' ? 'nowrap small danger-text' : 'nowrap small'}>{i.assignee}</td>
                <td className="nowrap"><TicketStatusChip status={i.status} /></td>
                <td className="nowrap small">{i.dueDate ? shortDay(i.dueDate) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return (
    <>
      <div className="stats-row">
        <div className={over ? 'stat stat-attn' : 'stat'}>
          <div className="stat-label">Tickets prévus</div>
          <div className="stat-value">{t.open}</div>
          <span className="small muted">{t.count - t.open ? `${t.count - t.open} déjà terminé(s)` : 'à traiter dans le sprint'}</span>
        </div>
        <div className="stat">
          <div className="stat-label">Rythme des derniers sprints</div>
          <div className="stat-value">{p.velocity !== null ? fmt(p.velocity) : '—'}</div>
          <span className="small muted">{p.velocity !== null ? 'tickets terminés par sprint en moyenne' : 'aucun sprint clos pour l’instant'}</span>
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
          {table(p.planned, 'Aucun ticket n’est encore prévu dans ce sprint : planifiez-en depuis la page Sprints.')}
        </section>
        <section className="card">
          <h2>Charge et rythme</h2>
          <div className="table-wrap">
            <table className="table table-compact table-scroll">
              <thead>
                <tr><th>Personne</th><th className="num">Tickets ouverts</th></tr>
              </thead>
              <tbody>
                {p.byAssignee.map((a) => (
                  <tr key={a.assignee}><td className={a.assignee === 'Non assigné' ? 'danger-text' : ''}>{a.assignee}</td><td className="num">{a.count}</td></tr>
                ))}
                {!p.byAssignee.length && <tr><td colSpan={2} className="muted">—</td></tr>}
              </tbody>
            </table>
          </div>
          <h3 className="mt">Derniers sprints</h3>
          {p.history.length ? (
            <ul className="list-plain small">
              {p.history.map((h) => (
                <li key={h.name}>{h.name} : <strong>{h.done}</strong> ticket{h.done > 1 ? 's' : ''} terminé{h.done > 1 ? 's' : ''} sur {h.active}</li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Aucun sprint clos pour l’instant.</p>
          )}
        </section>
      </div>

      <div className="grid-halves">
        {p.carryOverFrom && (
          <section className="card">
            <h2>Non terminés au {p.carryOverFrom}</h2>
            <p className="muted small">Reports probables : à la clôture du sprint en cours, ils peuvent passer dans ce sprint.</p>
            {table(p.carryOver, 'Aucun ticket ouvert dans le sprint en cours.')}
          </section>
        )}
        <section className="card">
          <h2>Backlog</h2>
          <p className="muted small">Les {p.backlog.length} tickets les plus urgents sur {p.backlogTotal} ouverts hors sprint (échéance la plus proche d’abord).</p>
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
            {d.sprint.state !== 'closed' && ' Les chiffres évoluent avec les tickets : rédigez à nouveau pour tenir compte des derniers changements.'}
          </p>
          <div className="toolbar-row no-print">
            <span className="small">Ajouter au journal du projet</span>
            <select className="input input-auto" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Projet">
              <option value="">Choisir un projet…</option>
              {d.projects.length > 0 && (
                <optgroup label="Projets des tickets du sprint">
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
            : 'L’assistant propose un objectif, compare le périmètre prévu au rythme des derniers sprints, arbitre reports et candidats du backlog, liste les points à clarifier et l’ordre du jour de la réunion de planification.'}{' '}
          Les descriptions des tickets ne lui sont pas envoyées. Vous pourrez modifier le document, le télécharger au format Word et l’ajouter au journal d’un projet.
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
