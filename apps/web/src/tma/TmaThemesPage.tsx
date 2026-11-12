import { Fragment, useState } from 'react';
import { Link } from 'react-router';
import { monthLabel } from '@samm/shared';
import { api } from '../api';
import { useJobPolling, useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner, formatDate, toast } from '../components/ui';
import { fmtH } from './common';
import { withAiRecap } from '../assistant/AiRecap';

const shortMonth = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });

/** Récurrences : nombre de tickets par thème et par mois de création, temps TMA imputé. */
export function TmaThemesPage() {
  const { data, error, loading, reload } = useLoad(() => api.tmaThemes(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJobPolling(jobId, async (j) => {
    setJobId(null);
    if (j.status === 'termine') toast(`${j.step}.`);
    else toast(j.error, 'error');
    await reload();
  });

  async function reclassify() {
    // Le récapitulatif annonce le nombre de tickets, le coût et le remplacement des thèmes actuels.
    try {
      const started = await withAiRecap(() => api.classifyTickets(true));
      if (started) setJobId(started.id);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const max = data ? Math.max(1, ...data.themes.flatMap((t) => Object.values(t.byMonth))) : 1;
  const total = data?.themes.reduce((n, t) => n + t.tickets, 0) ?? 0;

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <Link to="/tma" className="small">← Suivi TMA</Link>
          <h1>Thèmes et récurrences</h1>
        </div>
        <button className="btn btn-ghost" disabled={!!jobId || !total} onClick={() => void reclassify()}>Reclasser tous les tickets</button>
      </div>
      <p className="muted small">
        Tickets Desk par thème (attribué par l’assistant) et par mois de création. Les heures sont celles des relevés TMA importés, imputées aux tickets du thème.
        Cliquez sur un thème pour voir ses derniers tickets.
      </p>
      {job && jobId && <div className="alert alert-info"><Spinner small /> {job.step}</div>}
      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : !data?.themes.length ? (
        <EmptyState>Aucun ticket importé. <Link to="/tma">Importez un export Desk</Link>.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Thème</th>
                {data.months.map((m) => <th key={m} className="heat">{shortMonth(m)}</th>)}
                <th className="num">Tickets</th>
                <th className="num">Part</th>
                <th className="num">Temps TMA</th>
              </tr>
            </thead>
            <tbody>
              {data.themes.map((t) => (
                <Fragment key={t.theme}>
                  <tr className="row-click" onClick={() => setOpen(open === t.theme ? null : t.theme)}>
                    <td className="strong">{open === t.theme ? '▾' : '▸'} {t.theme}</td>
                    {data.months.map((m) => {
                      const n = t.byMonth[m] ?? 0;
                      // Une seule teinte, de plus en plus soutenue avec le nombre de tickets ; le nombre reste écrit.
                      return (
                        <td key={m} className="heat" title={`${t.theme} — ${monthLabel(m)} : ${n} ticket(s)`} style={n ? { background: `rgba(46, 116, 181, ${0.08 + (0.5 * n) / max})` } : undefined}>
                          {n || <span className="muted">·</span>}
                        </td>
                      );
                    })}
                    <td className="num strong">{t.tickets}</td>
                    <td className="num muted">{Math.round((t.tickets / total) * 100)} %</td>
                    <td className="num">{t.hours ? fmtH(t.hours) : <span className="muted">—</span>}</td>
                  </tr>
                  {open === t.theme && (
                    <tr>
                      <td colSpan={data.months.length + 4}>
                        <ul className="small">
                          {t.examples.map((x) => (
                            <li key={x.id}>
                              <span className="mono">#{x.id}</span> {x.subject} <span className="muted">— {formatDate(x.createdAt.slice(0, 10))}</span>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
