import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { decodeFile, guessEncoding, monthLabel, parseDeskExport, parseTmaWorkbook, unknownTmaPeople, type DeskImport, type TmaImport } from '@samm/shared';
import { api } from '../api';
import { useJobPolling, useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDate, formatDateTime, shortUser, toast } from '../components/ui';
import { useSettings } from '../settings/context';
import { fmtH, fmtN } from './common';
import { withAiRecap } from '../assistant/AiRecap';

/** Tickets envoyés par requête lors d'un import Desk. */
const DESK_CHUNK = 500;

type Pending = { kind: 'desk'; fileName: string; data: DeskImport } | { kind: 'tma'; fileName: string; data: TmaImport; month: string };

export function TmaHome() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.tmaOverview(), []);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const activeJob = jobId ?? data?.desk.activeJobId ?? null;
  const job = useJobPolling(activeJob, async (j) => {
    setJobId(null);
    if (j.status === 'termine') toast(`${j.step}.`);
    else toast(j.error, 'error');
    await reload();
  });

  async function open(files: FileList | File[]) {
    const file = [...files][0];
    if (!file) return;
    try {
      // Fichier lu et masqué sur ce poste : seules les colonnes utiles partiront au serveur.
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.xlsx$/i.test(file.name)) {
        const tma = parseTmaWorkbook(bytes);
        setPending({ kind: 'tma', fileName: file.name, data: tma, month: tma.month });
      } else if (/\.(csv|txt)$/i.test(file.name)) {
        setPending({ kind: 'desk', fileName: file.name, data: parseDeskExport(decodeFile(bytes, guessEncoding(bytes)).text) });
      } else toast('Format non pris en charge : export Desk en CSV, ou relevé TMA en Excel (.xlsx).', 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function confirmImport() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === 'desk') {
        let created = 0;
        let updated = 0;
        for (let i = 0; i < pending.data.tickets.length; i += DESK_CHUNK) {
          const r = await api.importDesk(pending.fileName, pending.data.tickets.slice(i, i + DESK_CHUNK));
          created += r.created;
          updated += r.updated;
        }
        toast(`${created} nouveau(x) ticket(s), ${updated} mis à jour.`);
        setPending(null);
        await reload();
      } else {
        const { syncedTickets, unknownPeople } = await api.putTmaMonth(pending.month, pending.fileName, pending.data.entries);
        toast(`Relevé de ${monthLabel(pending.month)} importé.${syncedTickets ? ` Temps passé mis à jour sur ${syncedTickets} ticket(s) du hub.` : ''}`);
        if (unknownPeople.length) toast(`Intervenant(s) absent(s) des contacts des prestataires, temps non compté : ${unknownPeople.join(', ')}.`, 'error');
        navigate(`/tma/mois/${pending.month}`);
      }
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function classify() {
    try {
      const started = await withAiRecap(() => api.classifyTickets(false));
      if (started) setJobId(started.id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const desk = data?.desk;
  const toClassify = desk ? desk.ticketCount - desk.classifiedCount : 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Suivi TMA</h1>
        <Link to="/tma/themes" className="btn">Thèmes et récurrences</Link>
      </div>

      <label
        className={`dropzone${drag ? ' dropzone-on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void open(e.dataTransfer.files);
        }}
      >
        <input type="file" hidden accept=".csv,.txt,.xlsx" onChange={(e) => e.target.files && void open(e.target.files)} />
        <div className="dropzone-icon">📥</div>
        <strong>Déposez un export de tickets Desk (CSV) ou le relevé TMA du mois (Excel)</strong>
        <span className="muted small">
          Le fichier est lu sur votre poste : seules les colonnes utiles sont envoyées, après masquage des données personnelles (noms, e-mails, téléphones,
          numéros de client, de commande et de chèque).
        </span>
      </label>

      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <h2 className="section-h">Relevés mensuels du prestataire</h2>
          {!data.months.length ? (
            <EmptyState>Aucun relevé importé. Déposez le fichier Excel envoyé chaque mois par le prestataire (ex. « TMA SEPTEMBRE.xlsx »).</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Mois</th>
                    <th className="num">Temps</th>
                    <th className="num">Jours</th>
                    <th className="num">Lignes</th>
                    <th>Synthèse</th>
                    <th>Importé</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((m) => (
                    <tr key={m.month}>
                      <td>
                        <Link to={`/tma/mois/${m.month}`} className="strong">{monthLabel(m.month)}</Link>
                        <div className="muted small">{m.fileName}</div>
                      </td>
                      <td className="num">{fmtH(m.totalHours)}</td>
                      <td className="num">{(m.totalHours / 8).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} j</td>
                      <td className="num">{m.entryCount}</td>
                      <td>{m.hasSynthesis ? <span className="badge status-valide">Rédigée</span> : <span className="muted small">—</span>}</td>
                      <td className="small">{formatDateTime(m.importedAt)}<div className="muted">{shortUser(m.importedBy)}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="section-h">Tickets Desk</h2>
          <section className="card">
            {desk && desk.ticketCount ? (
              <>
                <p>
                  <strong>{fmtN(desk.ticketCount)} ticket(s)</strong> créés du {formatDate(desk.firstCreatedAt!.slice(0, 10))} au {formatDate(desk.lastCreatedAt!.slice(0, 10))}
                  {desk.lastImportAt && (
                    <span className="muted small"> · dernier import le {formatDateTime(desk.lastImportAt)} par {shortUser(desk.lastImportBy ?? '')}</span>
                  )}
                </p>
                <p className="muted small">
                  Pour repérer les problèmes récurrents, l’assistant attribue un thème à chaque ticket (sujet et description masquée). Chaque ticket n’est classé
                  qu’une fois : seuls les nouveaux tickets sont envoyés.
                </p>
                {job && activeJob ? (
                  <div className="alert alert-info">
                    <Spinner small /> {job.step}
                  </div>
                ) : toClassify > 0 ? (
                  <button className="btn btn-ai" onClick={() => void classify()}>
                    ✨ Classer {fmtN(toClassify)} ticket(s) par thème
                  </button>
                ) : (
                  <p className="small">
                    Tous les tickets sont classés. <Link to="/tma/themes">Voir les thèmes et récurrences →</Link>
                  </p>
                )}
              </>
            ) : (
              <EmptyState>Aucun ticket importé. Exportez la liste des tickets depuis Desk (CSV) et déposez-la ci-dessus ; un export sur 90 jours est idéal pour démarrer.</EmptyState>
            )}
          </section>
        </>
      ) : null}

      {pending && (
        <Modal
          title={pending.kind === 'desk' ? 'Importer les tickets Desk' : 'Importer le relevé TMA'}
          onClose={() => !busy && setPending(null)}
          footer={
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={() => setPending(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => void confirmImport()}>
                {busy ? <Spinner small /> : 'Importer'}
              </button>
            </>
          }
        >
          {pending.kind === 'desk' ? <DeskPreview p={pending} /> : <TmaPreview p={pending} onMonth={(month) => setPending({ ...pending, month })} existing={data?.months.some((m) => m.month === pending.month) ?? false} />}
        </Modal>
      )}
    </div>
  );
}

/** Alerte : intervenants absents des carnets de contacts des prestataires (Paramétrage). */
function UnknownPeopleAlert({ people, what }: { people: string[]; what: string }) {
  if (!people.length) return null;
  return (
    <div className="alert alert-warn">
      <strong>{people.length} intervenant(s) absent(s) des contacts des prestataires</strong> : {people.join(', ')}. {what}{' '}
      <Link to="/parametrage?onglet=prestataires">Ajouter les contacts</Link>
    </div>
  );
}

function DeskPreview({ p }: { p: Extract<Pending, { kind: 'desk' }> }) {
  const { prestataires } = useSettings();
  const unknown = unknownTmaPeople(p.data.tickets.filter((t) => t.assignee).map((t) => ({ person: t.assignee })), prestataires);
  const dates = p.data.tickets.map((t) => t.createdAt).sort();
  const sample = p.data.tickets.find((t) => t.description.includes('[')) ?? p.data.tickets[0];
  return (
    <>
      <dl className="preview-kv">
        <dt>Fichier</dt>
        <dd>{p.fileName}</dd>
        <dt>Tickets</dt>
        <dd>{fmtN(p.data.tickets.length)}{p.data.skipped > 0 && <span className="muted"> ({p.data.skipped} ligne(s) illisible(s) ignorée(s))</span>}</dd>
        <dt>Période</dt>
        <dd>{dates.length ? `du ${formatDate(dates[0]!.slice(0, 10))} au ${formatDate(dates.at(-1)!.slice(0, 10))}` : '—'}</dd>
        <dt>Colonnes non envoyées</dt>
        <dd className="small">{p.data.ignoredColumns.join(', ') || '—'}</dd>
      </dl>
      <UnknownPeopleAlert people={unknown} what="Ajoutez-les au carnet de contacts de leur prestataire pour que le temps des relevés TMA leur soit compté." />
      <p className="muted small">Les tickets déjà importés sont mis à jour (statut…) et gardent leur thème. Exemple de ticket tel qu’il sera enregistré :</p>
      {sample && (
        <div className="masked-sample">
          <strong>#{sample.id} — {sample.subject}</strong>
          {'\n'}
          {sample.description.slice(0, 600)}
        </div>
      )}
    </>
  );
}

function TmaPreview({ p, onMonth, existing }: { p: Extract<Pending, { kind: 'tma' }>; onMonth: (m: string) => void; existing: boolean }) {
  const { prestataires } = useSettings();
  const unknown = unknownTmaPeople(p.data.entries, prestataires);
  const hours = p.data.entries.reduce((n, e) => n + e.hours, 0);
  const tickets = new Set(p.data.entries.flatMap((e) => e.tickets.map((t) => t.id)));
  const attached = p.data.entries.reduce((n, e) => n + e.hours - e.otherHours, 0);
  return (
    <>
      <dl className="preview-kv">
        <dt>Fichier</dt>
        <dd>{p.fileName}</dd>
        <dt>Mois</dt>
        <dd>
          <input className="input input-auto" type="month" value={p.month} onChange={(e) => e.target.value && onMonth(e.target.value)} />
        </dd>
        <dt>Lignes</dt>
        <dd>{p.data.entries.length}{p.data.skipped > 0 && <span className="muted"> ({p.data.skipped} ligne(s) de total ou vide(s) ignorée(s))</span>}</dd>
        <dt>Temps</dt>
        <dd>{fmtH(hours)} ({(hours / 8).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} j, 1 j = 8 h)</dd>
        <dt>Rattaché à un ticket</dt>
        <dd>{fmtH(attached)} sur {tickets.size} ticket(s) cité(s)</dd>
      </dl>
      {p.data.outOfMonth > 0 && <div className="alert alert-info">{p.data.outOfMonth} ligne(s) datée(s) hors de {monthLabel(p.month)}.</div>}
      <UnknownPeopleAlert people={unknown} what="Leur temps ne sera compté sur aucun prestataire tant qu’ils ne sont pas dans un carnet de contacts (Paramétrage)." />
      {existing && <div className="alert alert-info">Un relevé existe déjà pour {monthLabel(p.month)} : il sera remplacé (et sa synthèse effacée).</div>}
    </>
  );
}
