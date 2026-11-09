import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { deskKey, markdownToDoc, monthLabel, writeXlsx, type TmaMonthDetail } from '@samm/shared';
import { api } from '../api';
import { useJobPolling } from '../hooks';
import { ErrorBox, Spinner, formatDate, formatDateTime, shortUser, toast } from '../components/ui';
import { RichEditor } from '../editor/RichEditor';
import { Bar, BreakdownTable, delta, fmtH, fmtN } from './common';
import { ticketPath } from '../sprints/tickets';

const TOP_TICKETS = 20;

export function TmaMonthPage() {
  const month = useParams().month!;
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TmaMonthDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [allTickets, setAllTickets] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.tmaMonth(month);
      setDetail(d);
      setJobId(d.activeJobId);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  const job = useJobPolling(jobId, async (j) => {
    setJobId(null);
    if (j.status === 'termine') toast(`${j.step}.`);
    else toast(j.error, 'error');
    await load();
  });

  async function synthesize() {
    if (detail?.synthesis && !confirm('Rédiger une nouvelle synthèse ? La synthèse actuelle sera remplacée.')) return;
    try {
      setJobId((await api.writeTmaSynthesis(month)).id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function remove() {
    if (!confirm(`Supprimer le relevé de ${monthLabel(month)} ? Vous pourrez le réimporter à partir du fichier Excel.`)) return;
    try {
      await api.deleteTmaMonth(month);
      navigate('/tma');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (error) return <div className="page"><ErrorBox error={error} /><Link to="/tma">← Suivi TMA</Link></div>;
  if (!detail) return <div className="page"><Spinner /></div>;
  const r = detail.report;
  const p = r.previous ?? undefined;
  const tickets = allTickets ? r.byTicket : r.byTicket.slice(0, TOP_TICKETS);
  const maxTicket = r.byTicket[0]?.hours ?? 0;
  const maxPerson = r.byPerson[0]?.hours ?? 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Link to="/tma" className="small">← Suivi TMA</Link>
          <h1>TMA — {monthLabel(month)}</h1>
          <div className="muted small">
            {detail.info.fileName} · importé le {formatDateTime(detail.info.importedAt)} par {shortUser(detail.info.importedBy)}
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => exportXlsx(detail)}>Exporter (Excel)</button>
          <button className="btn btn-ghost" onClick={() => void remove()}>Supprimer</button>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat">
          <div className="stat-label">Temps total</div>
          <div className="stat-value">{fmtH(r.totalHours)}</div>
          <span className="small">{r.totalDays.toLocaleString('fr-FR')} jours</span>
          {delta(r.totalHours, p?.totalHours)}
        </div>
        <div className="stat">
          <div className="stat-label">Sur des tickets</div>
          <div className="stat-value">{fmtH(r.ticketHours)}</div>
          <span className="small">{r.byTicket.length} ticket(s)</span>
          {delta(r.ticketHours, p?.ticketHours)}
        </div>
        <div className="stat">
          <div className="stat-label">Pilotage et réunions</div>
          <div className="stat-value">{fmtH(r.pilotageHours)}</div>
          <span className="small">{r.totalHours ? Math.round((r.pilotageHours / r.totalHours) * 100) : 0} % du temps</span>
          {delta(r.pilotageHours, p?.pilotageHours)}
        </div>
        <div className="stat">
          <div className="stat-label">Autres activités hors ticket</div>
          <div className="stat-value">{fmtH(r.otherHours)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Tickets Desk créés</div>
          <div className="stat-value">{fmtN(r.createdTickets)}</div>
          {delta(r.createdTickets, p?.createdTickets)}
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Synthèse</h2>
          <button className="btn btn-ai" disabled={!!jobId} onClick={() => void synthesize()}>
            {jobId ? <Spinner small /> : '✨'} {detail.synthesis ? 'Rédiger à nouveau' : 'Rédiger la synthèse'}
          </button>
        </div>
        {job && jobId ? (
          <div className="alert alert-info"><Spinner small /> {job.step}</div>
        ) : detail.synthesis ? (
          <>
            <RichEditor key={detail.synthesis.createdAt} value={markdownToDoc(detail.synthesis.markdown)} onChange={() => {}} editable={false} cdcId="" sectionNumber={null} />
            <p className="muted small">Rédigée par l’assistant le {formatDateTime(detail.synthesis.createdAt)} à la demande de {shortUser(detail.synthesis.createdBy)}, à partir des seuls chiffres de cette page.</p>
          </>
        ) : (
          <p className="muted small">
            L’assistant rédige un commentaire du mois (faits marquants, récurrences, points d’attention) à partir des chiffres ci-dessous uniquement : ni le relevé
            brut ni les descriptions de tickets ne lui sont envoyés.
            {r.unclassified > 0 && ` ${r.unclassified} ticket(s) du mois ne sont pas encore classés par thème : classez-les d’abord depuis l’accueil du suivi TMA pour une analyse plus riche.`}
          </p>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Temps par intervenant</h2>
          <table className="table table-compact">
            <tbody>
              {r.byPerson.map((x) => (
                <tr key={x.key}>
                  <td>{x.key}</td>
                  <td className="bar-cell"><Bar value={x.hours} max={maxPerson} title={`${x.key} : ${fmtH(x.hours)}, dont ${fmtH(x.ticketHours)} sur tickets`} /></td>
                  <td className="num">{fmtH(x.hours)}</td>
                  <td className="num muted small">{x.hours ? Math.round((x.ticketHours / x.hours) * 100) : 0} % tickets</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h2>Temps par thème</h2>
          <BreakdownTable rows={r.timeByTheme} unit="hours" empty="Aucun ticket connu avec du temps." />
        </section>
        <section className="card">
          <h2>Temps par catégorie Desk</h2>
          <BreakdownTable rows={r.timeByCategory} unit="hours" empty="Aucun ticket connu avec du temps." />
        </section>
      </div>

      <section className="card">
        <h2>Tickets les plus consommateurs</h2>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Sujet</th>
                <th>Thème</th>
                <th>Statut</th>
                <th>Intervenants</th>
                <th className="bar-cell" />
                <th className="num">Temps</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="mono">
                    #{t.id}
                    {(detail.hubTickets?.[deskKey(t.id)] ?? []).map((h) => (
                      <div key={h.id} className="small">
                        <Link to={ticketPath(h)} title={`${h.title} (${h.projectName})`}>{h.key}</Link>
                      </div>
                    ))}
                  </td>
                  <td>
                    {t.ticket ? t.ticket.subject : <span className="muted">Inconnu des exports Desk</span>}
                    {t.ticket && <div className="muted small">{t.ticket.category} · créé le {formatDate(t.ticket.createdAt.slice(0, 10))}</div>}
                  </td>
                  <td className="small">{t.ticket?.theme || <span className="muted">—</span>}</td>
                  <td className="small">{t.ticket?.status}</td>
                  <td className="small">{t.people.join(', ')}</td>
                  <td className="bar-cell"><Bar value={t.hours} max={maxTicket} title={`#${t.id} : ${fmtH(t.hours)}`} /></td>
                  <td className="num">{fmtH(t.hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.byTicket.length > TOP_TICKETS && (
          <button className="btn btn-link" onClick={() => setAllTickets((v) => !v)}>
            {allTickets ? 'Afficher moins' : `Afficher les ${r.byTicket.length} tickets`}
          </button>
        )}
        {r.unknownTickets.length > 0 && (
          <p className="muted small">
            {r.unknownTickets.length} ticket(s) cité(s) dans le relevé sont absents des exports Desk importés (évolutions ou tickets anciens) : importez un export
            plus large pour avoir leur sujet.
          </p>
        )}
      </section>

      <h2 className="section-h">Tickets Desk créés en {monthLabel(month)}</h2>
      <div className="grid-2">
        <section className="card">
          <h2>Par thème</h2>
          <BreakdownTable rows={r.created.byTheme} unit="count" empty="Aucun ticket créé ce mois-ci dans les exports importés." />
        </section>
        <section className="card">
          <h2>Par catégorie</h2>
          <BreakdownTable rows={r.created.byCategory} unit="count" empty="—" />
        </section>
        <section className="card">
          <h2>Par cause</h2>
          <BreakdownTable rows={r.created.byCause} unit="count" empty="—" />
        </section>
        <section className="card">
          <h2>Par priorité</h2>
          <BreakdownTable rows={r.created.byPriority} unit="count" empty="—" />
        </section>
      </div>

      <section className="card">
        <h2>Activités hors ticket</h2>
        {!r.unattached.length ? (
          <p className="muted small">Tout le temps est rattaché à des tickets.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Intervenant</th>
                  <th>Nature</th>
                  <th>Commentaire</th>
                  <th className="num">Temps</th>
                </tr>
              </thead>
              <tbody>
                {r.unattached.map((u, i) => (
                  <tr key={i}>
                    <td className="nowrap">{formatDate(u.date)}</td>
                    <td className="nowrap">{u.person}</td>
                    <td>{u.activity === 'pilotage' ? 'Pilotage' : 'Autre'}</td>
                    <td className="small">{u.comment}</td>
                    <td className="num">{fmtH(u.hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Classeur Excel du mois, produit dans le navigateur. */
function exportXlsx(d: TmaMonthDetail) {
  const r = d.report;
  const bytes = writeXlsx([
    {
      name: 'Chiffres clés',
      rows: [
        ['Indicateur', monthLabel(r.month), r.previous ? monthLabel(r.previous.month) : ''],
        ['Temps total (h)', r.totalHours, r.previous?.totalHours ?? null],
        ['Temps sur tickets (h)', r.ticketHours, r.previous?.ticketHours ?? null],
        ['Pilotage et réunions (h)', r.pilotageHours, r.previous?.pilotageHours ?? null],
        ['Autres activités hors ticket (h)', r.otherHours, r.previous?.otherHours ?? null],
        ['Tickets Desk créés', r.createdTickets, r.previous?.createdTickets ?? null],
      ],
    },
    {
      name: 'Par ticket',
      rows: [
        ['Ticket', 'Sujet', 'Catégorie', 'Thème', 'Statut', 'Créé le', 'Intervenants', 'Heures'],
        ...r.byTicket.map((t) => [Number(t.id), t.ticket?.subject ?? '(inconnu des exports Desk)', t.ticket?.category ?? '', t.ticket?.theme ?? '', t.ticket?.status ?? '', t.ticket?.createdAt.slice(0, 10) ?? '', t.people.join(', '), t.hours]),
      ],
    },
    { name: 'Par intervenant', rows: [['Intervenant', 'Heures', 'Dont tickets'], ...r.byPerson.map((x) => [x.key, x.hours, x.ticketHours])] },
    { name: 'Par thème', rows: [['Thème', 'Heures', 'Tickets avec du temps'], ...r.timeByTheme.map((x) => [x.key, x.hours, x.count])] },
    {
      name: 'Relevé',
      rows: [
        ['Date', 'Intervenant', 'Heures', 'Tickets', 'Heures hors ticket', 'Nature hors ticket', 'Commentaire'],
        ...d.entries.map((e) => [e.date, e.person, e.hours, e.tickets.map((t) => `#${t.id} (${t.hours} h)`).join(', '), e.otherHours, e.otherHours ? (e.activity === 'pilotage' ? 'Pilotage' : 'Autre') : '', e.comment]),
      ],
    },
  ]);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `Suivi_TMA_${r.month}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
