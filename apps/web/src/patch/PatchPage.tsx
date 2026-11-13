import { useMemo, useState } from 'react';
import {
  PATCH_ENVS,
  PATCH_ENV_LABELS,
  PATCH_STATUSES,
  PATCH_STATUS_LABELS,
  parisDay,
  parsePatchTestsSheet,
  readXlsx,
  sessionProgress,
  type PatchEnv,
  type PatchImportBody,
  type PatchOverview,
  type PatchSession,
  type PatchStatus,
  type PatchTest,
} from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDate, formatDateTime, toast } from '../components/ui';
import { ItemModal } from '../projects/common';
import { useUsers } from '../users/context';

/** Sessions affichées tant qu'on ne demande pas tout l'historique. */
const RECENT = 6;

async function attempt<T>(fn: () => Promise<T>, done?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (done) toast(done);
    return r;
  } catch (e) {
    toast((e as Error).message, 'error');
    return null;
  }
}

/**
 * Patch management : les tests à réaliser après chaque patch (une ligne par test, configurable) et, en colonnes, les
 * sessions de patch (production ou testing, à une date), où chacun note le résultat de chaque test. Remplace l'onglet
 * « Tests » du classeur de l'équipe, que l'on peut reprendre une fois au départ (lu dans le navigateur).
 */
export function PatchPage() {
  const { data, setData, error, loading, reload } = useLoad(() => api.patch(), []);
  const [all, setAll] = useState(false);
  const [editLines, setEditLines] = useState(false);
  const [sessionForm, setSessionForm] = useState<PatchSession | 'new' | null>(null);
  const [testForm, setTestForm] = useState<PatchTest | 'new' | null>(null);
  const [cell, setCell] = useState<{ session: PatchSession; test: PatchTest } | null>(null);
  const [importing, setImporting] = useState<PatchImportBody | null>(null);

  const sessions = useMemo(() => (data ? (all ? data.sessions : data.sessions.slice(0, RECENT)) : []), [data, all]);
  // Un test retiré reste affiché tant qu'une session affichée en a le résultat.
  const tests = useMemo(
    () => (data?.tests ?? []).filter((t) => editLines || !t.archived || sessions.some((s) => s.results[t.id]?.status)),
    [data, sessions, editLines],
  );
  const replaceSession = (s: PatchSession) => setData((d) => d && { ...d, sessions: d.sessions.map((x) => (x.id === s.id ? s : x)) });

  async function readWorkbook(file: File) {
    try {
      const sheets = readXlsx(new Uint8Array(await file.arrayBuffer()));
      const found = sheets.map((s) => parsePatchTestsSheet(s.rows)).find(Boolean);
      if (!found) throw new Error('Onglet des tests introuvable : il faut un tableau avec les colonnes « Qui », « Quoi », « Description ».');
      setImporting(found);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function move(t: PatchTest, delta: -1 | 1) {
    const ids = (data?.tests ?? []).map((x) => x.id);
    const i = ids.indexOf(t.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const out = await attempt(() => api.reorderPatchTests(ids));
    if (out) setData(out);
  }

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>🔧 Patch management</h1>
          <p className="muted">Les tests à faire après chaque patch des serveurs, et leur résultat à chaque session. Cliquez sur une case pour noter le résultat.</p>
        </div>
        <div className="row-actions">
          <button className={editLines ? 'btn btn-primary' : 'btn'} onClick={() => setEditLines(!editLines)}>{editLines ? '✓ Terminer' : '✏️ Lignes de tests'}</button>
          <button className="btn btn-primary" onClick={() => setSessionForm('new')}>+ Nouvelle session</button>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data && !data.tests.length ? (
        <EmptyState>
          <p>Aucun test pour l’instant.</p>
          <div className="row-actions">
            <button className="btn btn-primary" onClick={() => setTestForm('new')}>+ Ajouter un test</button>
            <label className="btn">
              📥 Reprendre l’ancien classeur Excel…
              <input type="file" hidden accept=".xlsx" onChange={(e) => e.target.files?.[0] && void readWorkbook(e.target.files[0])} />
            </label>
          </div>
          <p className="muted small">Le classeur est lu sur votre poste : seuls les tests et les résultats de l’onglet « Tests » sont enregistrés.</p>
        </EmptyState>
      ) : (
        data && (
          <>
            {editLines && (
              <p className="muted small">
                Ajoutez, modifiez et réordonnez les tests. Un test déjà renseigné ne se supprime pas : retirez-le, il disparaît des nouvelles sessions et reste dans
                l’historique.
              </p>
            )}
            <div className="table-wrap table-scroll patch-wrap">
              <table className="table table-compact patch-table">
                <thead>
                  <tr>
                    {editLines && <th aria-label="Ordre" />}
                    <th>Qui</th>
                    <th>Test</th>
                    {sessions.map((s) => {
                      const p = sessionProgress(s, data.tests);
                      return (
                        <th key={s.id} className="patch-col">
                          <button className="patch-col-head" onClick={() => setSessionForm(s)} title="Modifier ou supprimer la session">
                            <span className={s.env === 'PROD' ? 'badge badge-danger' : 'badge'}>{s.env}</span>
                            <strong>{formatDate(s.date)}</strong>
                            {s.note && <span className="muted small">{s.note}</span>}
                            <span className="muted small">{p.done}/{p.total}{p.ko > 0 && <span className="due-late"> · {p.ko} KO</span>}</span>
                          </button>
                        </th>
                      );
                    })}
                    {editLines && <th aria-label="Actions" />}
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t, i) => (
                    <tr key={t.id} className={t.archived ? 'patch-archived' : undefined}>
                      {editLines && (
                        <td className="nowrap">
                          <button className="btn-icon" title="Monter" disabled={i === 0} onClick={() => void move(t, -1)}>↑</button>
                          <button className="btn-icon" title="Descendre" disabled={i === tests.length - 1} onClick={() => void move(t, 1)}>↓</button>
                        </td>
                      )}
                      <td className="small nowrap">{t.who || '—'}</td>
                      <td className="patch-test">
                        <strong>{t.what}</strong>
                        {t.archived && <span className="muted small"> (retiré)</span>}
                        {t.description && <div className="small">{t.description}</div>}
                        {t.expected && <div className="small muted patch-expected">Attendu : {t.expected}</div>}
                        {(t.urlProd || t.urlTest) && (
                          <div className="small">
                            {t.urlProd && <a href={t.urlProd} target="_blank" rel="noreferrer">PROD ↗</a>} {t.urlTest && <a href={t.urlTest} target="_blank" rel="noreferrer">TEST ↗</a>}
                          </div>
                        )}
                      </td>
                      {sessions.map((s) => {
                        const r = s.results[t.id];
                        return (
                          <td key={s.id} className="patch-cell">
                            <button className={`patch-status patch-${r?.status || 'vide'}`} onClick={() => setCell({ session: s, test: t })} title={r?.comment || 'Noter le résultat'}>
                              {r?.status ? (r.status === 'na' ? '—' : PATCH_STATUS_LABELS[r.status]) : '·'}
                              {r?.comment && ' 💬'}
                            </button>
                          </td>
                        );
                      })}
                      {editLines && (
                        <td className="nowrap">
                          <button className="btn btn-sm btn-ghost" onClick={() => setTestForm(t)}>Modifier</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row-actions mt">
              {editLines && <button className="btn btn-sm" onClick={() => setTestForm('new')}>+ Ajouter un test</button>}
              {data.sessions.length > RECENT && (
                <button className="btn-link small" onClick={() => setAll(!all)}>{all ? 'Seulement les dernières sessions' : `Afficher tout l’historique (${data.sessions.length} sessions)`}</button>
              )}
              {!data.sessions.length && <span className="muted small">Créez une session de patch pour noter les résultats des tests.</span>}
            </div>
          </>
        )
      )}

      {sessionForm && <SessionModal session={sessionForm === 'new' ? null : sessionForm} onClose={() => setSessionForm(null)} onSaved={reload} />}
      {testForm && <TestModal test={testForm === 'new' ? null : testForm} onClose={() => setTestForm(null)} onSaved={reload} />}
      {cell && <ResultModal {...cell} onClose={() => setCell(null)} onSaved={(s) => replaceSession(s)} />}
      {importing && <ImportModal data={importing} onClose={() => setImporting(null)} onDone={(o) => setData(o)} />}
    </div>
  );
}

function SessionModal({ session, onClose, onSaved }: { session: PatchSession | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ env: session?.env ?? ('PROD' as PatchEnv), date: session?.date ?? parisDay(Date.now()), note: session?.note ?? '' });
  async function remove() {
    if (!session || !confirm(`Supprimer la session ${session.env} du ${formatDate(session.date)} et ses résultats ?`)) return;
    if ((await attempt(() => api.deletePatchSession(session.id), 'Session supprimée.')) !== null) {
      onClose();
      await onSaved();
    }
  }
  return (
    <ItemModal
      title={session ? 'Session de patch' : 'Nouvelle session de patch'}
      onClose={onClose}
      canSave={!!f.date}
      onSave={async () => {
        if (session) await api.updatePatchSession(session.id, f);
        else await api.createPatchSession(f);
        await onSaved();
      }}
      extraFooter={session && <button className="btn btn-danger-ghost" onClick={() => void remove()}>Supprimer</button>}
    >
      <label className="field">
        <span>Environnement</span>
        <select className="input" value={f.env} onChange={(e) => setF({ ...f, env: e.target.value as PatchEnv })}>
          {PATCH_ENVS.map((e) => <option key={e} value={e}>{PATCH_ENV_LABELS[e]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Date</span>
        <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      <label className="field span-2">
        <span>Précision</span>
        <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="ex. 20:00 à 22:00" maxLength={200} />
      </label>
    </ItemModal>
  );
}

function TestModal({ test, onClose, onSaved }: { test: PatchTest | null; onClose: () => void; onSaved: () => Promise<unknown> }) {
  const [f, setF] = useState({ who: test?.who ?? '', what: test?.what ?? '', description: test?.description ?? '', expected: test?.expected ?? '', urlProd: test?.urlProd ?? '', urlTest: test?.urlTest ?? '' });
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function archive(archived: boolean) {
    if (!test) return;
    if (await attempt(() => api.updatePatchTest(test.id, { archived }), archived ? 'Test retiré des nouvelles sessions.' : 'Test remis dans la liste.')) {
      onClose();
      await onSaved();
    }
  }
  async function remove() {
    if (!test || !confirm(`Supprimer le test « ${test.what || test.description} » ?`)) return;
    if ((await attempt(() => api.deletePatchTest(test.id), 'Test supprimé.')) !== null) {
      onClose();
      await onSaved();
    }
  }
  return (
    <ItemModal
      title={test ? 'Test' : 'Nouveau test'}
      onClose={onClose}
      wide
      canSave={!!(f.what.trim() || f.description.trim())}
      onSave={async () => {
        if (test) await api.updatePatchTest(test.id, f);
        else await api.createPatchTest(f);
        await onSaved();
      }}
      extraFooter={
        test && (
          <>
            <button className="btn btn-ghost" onClick={() => void archive(!test.archived)}>{test.archived ? 'Remettre dans la liste' : 'Retirer'}</button>
            <button className="btn btn-danger-ghost" onClick={() => void remove()}>Supprimer</button>
          </>
        )
      }
    >
      <label className="field">
        <span>Qui</span>
        <input className="input" value={f.who} onChange={(e) => set('who', e.target.value)} placeholder="Équipe, prestataire…" />
      </label>
      <label className="field">
        <span>Quoi</span>
        <input className="input" autoFocus value={f.what} onChange={(e) => set('what', e.target.value)} placeholder="Application, serveur, proxy…" />
      </label>
      <label className="field span-2">
        <span>Description</span>
        <textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </label>
      <label className="field span-2">
        <span>Paramètres et résultat attendu</span>
        <textarea className="input" rows={2} value={f.expected} onChange={(e) => set('expected', e.target.value)} />
      </label>
      <label className="field">
        <span>Adresse en production</span>
        <input className="input" value={f.urlProd} onChange={(e) => set('urlProd', e.target.value)} placeholder="https://…" />
      </label>
      <label className="field">
        <span>Adresse en testing</span>
        <input className="input" value={f.urlTest} onChange={(e) => set('urlTest', e.target.value)} placeholder="https://…" />
      </label>
    </ItemModal>
  );
}

/** Résultat d'un test dans une session : OK, KO, sans objet (ou à faire), et un commentaire. */
function ResultModal({ session, test, onClose, onSaved }: { session: PatchSession; test: PatchTest; onClose: () => void; onSaved: (s: PatchSession) => void }) {
  const { name } = useUsers();
  const before = session.results[test.id];
  const [status, setStatus] = useState<PatchStatus | ''>(before?.status ?? '');
  const [comment, setComment] = useState(before?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const url = session.env === 'PROD' ? test.urlProd : test.urlTest;
  async function save(next = status) {
    setBusy(true);
    const s = await attempt(() => api.setPatchResult(session.id, test.id, { status: next, comment }));
    setBusy(false);
    if (s) {
      onSaved(s);
      onClose();
    }
  }
  return (
    <Modal
      title={`${test.what || 'Test'} — ${session.env} du ${formatDate(session.date)}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy && <Spinner small />} Enregistrer</button>
        </>
      }
    >
      {test.description && <p>{test.description}</p>}
      {test.expected && <p className="muted small">Attendu : {test.expected}</p>}
      {url && <p className="small"><a href={url} target="_blank" rel="noreferrer">{url} ↗</a></p>}
      <div className="seg seg-wrap mt" role="group" aria-label="Résultat">
        {PATCH_STATUSES.map((s) => (
          <button key={s} type="button" className={status === s ? 'on' : undefined} aria-pressed={status === s} onClick={() => setStatus(s)}>{PATCH_STATUS_LABELS[s]}</button>
        ))}
        <button type="button" className={status === '' ? 'on' : undefined} aria-pressed={status === ''} onClick={() => setStatus('')}>À faire</button>
      </div>
      <label className="field mt">
        <span>Commentaire</span>
        <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="ex. Pas de mire Ingenico, ticket ouvert…" />
      </label>
      {before?.at && <p className="muted small">Dernière saisie par {name(before.by)} le {formatDateTime(before.at)}</p>}
    </Modal>
  );
}

function ImportModal({ data, onClose, onDone }: { data: PatchImportBody; onClose: () => void; onDone: (o: PatchOverview) => void }) {
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const out = await attempt(() => api.importPatch(data), 'Classeur repris.');
    setBusy(false);
    if (out) {
      onDone(out);
      onClose();
    }
  }
  const results = data.sessions.reduce((n, s) => n + s.results.length, 0);
  return (
    <Modal
      title="Reprendre l’ancien classeur"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void run()}>{busy && <Spinner small />} Reprendre</button>
        </>
      }
    >
      <p>
        <strong>{data.tests.length} tests</strong> et <strong>{data.sessions.length} sessions</strong> ({results} résultats) seront enregistrés.
      </p>
      <ul className="small">
        {data.tests.slice(0, 8).map((t, i) => <li key={i}>{[t.who, t.what, t.description].filter(Boolean).join(' · ')}</li>)}
        {data.tests.length > 8 && <li className="muted">…</li>}
      </ul>
    </Modal>
  );
}
