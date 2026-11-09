import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CLOSED_PROJECT_STATUSES, isJalonLate, jalonDrift, type PlanningProject, type ProjectJalon } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, formatDate, Spinner } from '../components/ui';
import { DueLabel, HealthBadge } from './common';

const PERIODS = [
  { id: '6', label: '6 mois', before: 1, after: 5 },
  { id: '12', label: '12 mois', before: 2, after: 10 },
  { id: 'tout', label: 'Tout', before: 0, after: 0 },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAY = 86400000;

/** Premier jour du mois de `iso`, décalé de `delta` mois. */
function monthStart(iso: string, delta = 0): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

const jalonClass = (j: ProjectJalon) => (j.done ? 'tl-done' : isJalonLate(j) ? 'tl-late' : 'tl-todo');

/** Frise de tous les projets : une ligne par projet, ses jalons, sa période (début → fin visée), et la liste par mois. */
export function GlobalPlanningPage() {
  const { data, error, loading } = useLoad(() => api.planning(), []);
  const [period, setPeriod] = useState<PeriodId>('12');
  const [withClosed, setWithClosed] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const projects = useMemo(
    () =>
      (data ?? [])
        .filter((p) => withClosed || !CLOSED_PROJECT_STATUSES.includes(p.status))
        .map((p) => ({ ...p, jalons: p.jalons.filter((j) => j.date && (!onlyPending || !j.done)).sort((a, b) => a.date.localeCompare(b.date)) }))
        .filter((p) => p.jalons.length || p.startDate || p.targetDate),
    [data, withClosed, onlyPending],
  );

  // Fenêtre affichée, en mois entiers.
  const dates = projects.flatMap((p) => [...p.jalons.map((j) => j.date), p.startDate, p.targetDate]).filter(Boolean);
  const per = PERIODS.find((x) => x.id === period)!;
  const from = period === 'tout' ? monthStart([today, ...dates].sort()[0]!) : monthStart(today, -per.before);
  const to = period === 'tout' ? monthStart([today, ...dates].sort().at(-1)!, 1) : monthStart(today, per.after + 1);
  const min = Date.parse(from);
  const span = Math.max(Date.parse(to) - min, DAY);
  const pos = (d: string) => ((Date.parse(d) - min) / span) * 100;
  const inWindow = (d: string) => d >= from && d < to;
  const months: string[] = [];
  for (let m = from; m < to; m = monthStart(m, 1)) months.push(m);

  // Ordre : prochain jalon à venir d'abord, puis les projets sans jalon à venir.
  const nextOf = (p: PlanningProject) => p.jalons.find((j) => !j.done)?.date ?? '9999';
  const rows = [...projects].sort((a, b) => nextOf(a).localeCompare(nextOf(b)) || a.name.localeCompare(b.name, 'fr'));

  const all = rows.flatMap((p) => p.jalons.filter((j) => inWindow(j.date)).map((j) => ({ ...j, project: p })));
  all.sort((a, b) => a.date.localeCompare(b.date));
  const byMonth = new Map<string, typeof all>();
  for (const j of all) byMonth.set(j.date.slice(0, 7), [...(byMonth.get(j.date.slice(0, 7)) ?? []), j]);
  const late = rows.reduce((n, p) => n + p.jalons.filter((j) => isJalonLate(j)).length, 0);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Planning des projets</h1>
          <p className="muted small">Les jalons de tous les projets sur une même frise. Ils se saisissent dans l’onglet « Planning » de chaque projet.</p>
        </div>
        <div className="actions">
          <div className="seg" role="group" aria-label="Période">
            {PERIODS.map((x) => (
              <button key={x.id} className={x.id === period ? 'on' : ''} onClick={() => setPeriod(x.id)}>{x.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="toolbar-row">
        <label className="check"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Seulement les jalons à atteindre</label>
        <label className="check"><input type="checkbox" checked={withClosed} onChange={(e) => setWithClosed(e.target.checked)} /> Inclure les projets clos</label>
        {late > 0 && <span className="badge badge-danger">{late} jalon(s) en retard</span>}
        <span className="tb-flex" />
        <span className="gp-legend small muted">
          <span><i className="gp-dot tl-todo" /> à venir</span>
          <span><i className="gp-dot tl-late" /> en retard</span>
          <span><i className="gp-dot tl-done" /> atteint</span>
          <span><i className="gp-bar-sample" /> début → fin visée</span>
        </span>
      </div>

      <ErrorBox error={error} />
      {loading && !data && <Spinner />}
      {data && !rows.length && <EmptyState>Aucun jalon daté. Ajoutez les grandes dates dans l’onglet « Planning » de vos projets.</EmptyState>}

      {rows.length > 0 && (
        <section className="card gp-card">
          <div className="gp">
            <div className="gp-row gp-head">
              <div className="gp-name" />
              <div className="gp-track">
                {months.map((m) => (
                  <span key={m} className="gp-month" style={{ left: `${pos(m)}%` }}>
                    {MONTHS[Number(m.slice(5, 7)) - 1]}{m.slice(5, 7) === '01' || m === from ? ` ${m.slice(0, 4)}` : ''}
                  </span>
                ))}
              </div>
            </div>
            {rows.map((p) => {
              const start = p.startDate && p.startDate < to ? (p.startDate > from ? p.startDate : from) : '';
              const end = p.targetDate && p.targetDate >= from ? (p.targetDate < to ? p.targetDate : to) : '';
              const hidden = p.jalons.filter((j) => !inWindow(j.date)).length;
              return (
                <div key={p.id} className="gp-row">
                  <div className="gp-name">
                    <HealthBadge health={p.health} withLabel={false} />
                    <Link to={`/projets/${p.id}?onglet=planning`} title={p.name}>{p.code ? `${p.code} · ` : ''}{p.name}</Link>
                    {hidden > 0 && <span className="muted small" title="Jalons hors de la période affichée">+{hidden}</span>}
                  </div>
                  <div className="gp-track">
                    {months.map((m) => <span key={m} className="gp-grid" style={{ left: `${pos(m)}%` }} />)}
                    {start && end && end > start && (
                      <span className="gp-bar" style={{ left: `${pos(start)}%`, width: `${pos(end) - pos(start)}%` }} title={`Du ${formatDate(p.startDate)} au ${formatDate(p.targetDate)}`} />
                    )}
                    {/* Libellés alternés au-dessus et en dessous de l'axe : deux jalons proches ne se chevauchent pas. */}
                    {p.jalons.filter((j) => inWindow(j.date)).map((j, i) => (
                      <span key={j.id} className={`gp-jalon ${jalonClass(j)} ${i % 2 ? 'gp-below' : 'gp-above'}${pos(j.date) > 85 ? ' gp-end' : ''}`} style={{ left: `${pos(j.date)}%` }} title={`${j.label} — ${formatDate(j.date)}${j.done ? ' (atteint)' : ''}`}>
                        <i className="gp-dot" />
                        <span className="gp-label">{j.label}</span>
                      </span>
                    ))}
                    {inWindow(today) && <span className="gp-today" style={{ left: `${pos(today)}%` }} />}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {byMonth.size > 0 && (
        <section className="card">
          <h2>Jalons de la période</h2>
          {[...byMonth].map(([month, list]) => (
            <div key={month} className="gp-month-block">
              <h3>{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Date</th>
                      <th>Jalon</th>
                      <th>Projet</th>
                      <th>Glissement</th>
                      <th>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((j) => {
                      const drift = jalonDrift(j);
                      return (
                        <tr key={j.id} className={j.done ? 'row-done' : ''}>
                          <td><DueLabel date={j.date} done={j.done} /></td>
                          <td>{j.label}</td>
                          <td><Link to={`/projets/${j.project.id}?onglet=planning`}>{j.project.name}</Link></td>
                          <td>
                            {drift !== 0 ? (
                              <span className={drift > 0 ? 'due-late' : 'ok-text'} title={`Date initiale : ${formatDate(j.initialDate)}`}>{drift > 0 ? '+' : ''}{drift} j</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>{j.done ? <span className="badge badge-ok">Atteint</span> : isJalonLate(j) ? <span className="badge badge-danger">En retard</span> : <span className="badge">À venir</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
