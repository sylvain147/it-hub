import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CLOSED_PROJECT_STATUSES, isJalonLate, jalonDrift, jalonPeriod, type PlanningProject, type PlanningTodo, type ProjectJalon } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, formatDate, Spinner } from '../components/ui';
import { useUsers } from '../users/context';
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
const todoLate = (t: PlanningTodo, today: string) => !t.done && t.dueDate < today;
const todoClass = (t: PlanningTodo, today: string) => (t.done ? 'tl-done' : todoLate(t, today) ? 'tl-late' : 'tl-todo');

/** Ligne de la frise : un projet, ou « Ma to-do » (tâches hors projet). */
type Row = Pick<PlanningProject, 'jalons' | 'todos'> & { project: PlanningProject | null };

/** Élément de la liste mois par mois : un jalon ou une tâche de la to-do. */
type Entry = { kind: 'jalon'; date: string; jalon: ProjectJalon; project: PlanningProject } | { kind: 'todo'; date: string; todo: PlanningTodo; project: PlanningProject | null };

/**
 * Frise de tous les projets : une ligne par projet avec ses jalons (ponctuels ou sur une période), sa période
 * (début → fin visée) et, au choix, les tâches de la to-do qui ont une échéance ; puis la liste par mois.
 */
export function GlobalPlanningPage() {
  const { me } = useAuth();
  const { name } = useUsers();
  const { data, error, loading } = useLoad(() => api.planning(), []);
  const mine = useLoad(() => api.todos(), []);
  const [period, setPeriod] = useState<PeriodId>('12');
  const [withClosed, setWithClosed] = useState(false);
  const [onlyPending, setOnlyPending] = useState(false);
  const [withTodos, setWithTodos] = useState(true);
  const today = new Date().toISOString().slice(0, 10);

  const rows = useMemo<Row[]>(() => {
    const keep = (done: boolean) => !onlyPending || !done;
    const projects = (data ?? [])
      .filter((p) => withClosed || !CLOSED_PROJECT_STATUSES.includes(p.status))
      .map((p) => ({
        project: p,
        jalons: p.jalons.filter((j) => j.date && keep(j.done)).sort((a, b) => a.date.localeCompare(b.date)),
        todos: withTodos ? p.todos.filter((t) => keep(t.done)) : [],
      }))
      .filter((r) => r.jalons.length || r.todos.length || r.project.startDate || r.project.targetDate);
    // Ordre : prochaine échéance à venir d'abord, puis les projets sans échéance.
    const nextOf = (r: Row) => [...r.jalons.filter((j) => !j.done).map((j) => j.date), ...r.todos.filter((t) => !t.done).map((t) => t.dueDate)].sort()[0] ?? '9999';
    projects.sort((a, b) => nextOf(a).localeCompare(nextOf(b)) || a.project.name.localeCompare(b.project.name, 'fr'));
    // Ma to-do hors projet (tâches qui me sont attribuées).
    const personal = withTodos
      ? (mine.data?.personal ?? [])
          .filter((t) => !t.projectId && t.dueDate && t.assigneeId === me.email && keep(t.done))
          .map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, done: t.done, assigneeId: t.assigneeId }))
      : [];
    return personal.length ? [...projects, { project: null, jalons: [], todos: personal }] : projects;
  }, [data, mine.data, withClosed, onlyPending, withTodos, me.email]);

  // Fenêtre affichée, en mois entiers.
  const dates = rows.flatMap((r) => [...r.jalons.flatMap((j) => [j.startDate, j.date]), ...r.todos.map((t) => t.dueDate), r.project?.startDate ?? '', r.project?.targetDate ?? '']).filter(Boolean);
  const per = PERIODS.find((x) => x.id === period)!;
  const from = period === 'tout' ? monthStart([today, ...dates].sort()[0]!) : monthStart(today, -per.before);
  const to = period === 'tout' ? monthStart([today, ...dates].sort().at(-1)!, 1) : monthStart(today, per.after + 1);
  const min = Date.parse(from);
  const span = Math.max(Date.parse(to) - min, DAY);
  const pos = (d: string) => ((Date.parse(d) - min) / span) * 100;
  const inWindow = (d: string) => d >= from && d < to;
  const months: string[] = [];
  for (let m = from; m < to; m = monthStart(m, 1)) months.push(m);

  const entries: Entry[] = rows.flatMap((r) => [
    ...(r.project ? r.jalons.filter((j) => inWindow(j.date)).map((j): Entry => ({ kind: 'jalon', date: j.date, jalon: j, project: r.project! })) : []),
    ...r.todos.filter((t) => inWindow(t.dueDate)).map((t): Entry => ({ kind: 'todo', date: t.dueDate, todo: t, project: r.project })),
  ]);
  entries.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'jalon' ? -1 : 1));
  const byMonth = new Map<string, Entry[]>();
  for (const e of entries) byMonth.set(e.date.slice(0, 7), [...(byMonth.get(e.date.slice(0, 7)) ?? []), e]);
  const late = rows.reduce((n, r) => n + r.jalons.filter((j) => isJalonLate(j)).length, 0);
  const lateTodos = rows.reduce((n, r) => n + r.todos.filter((t) => todoLate(t, today)).length, 0);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Planning des projets</h1>
          <p className="muted small">
            Les jalons de tous les projets sur une même frise, avec les tâches de la to-do qui ont une échéance. Les jalons se saisissent dans l’onglet « Planning » de
            chaque projet.
          </p>
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
        <label className="check"><input type="checkbox" checked={withTodos} onChange={(e) => setWithTodos(e.target.checked)} /> Afficher la to-do</label>
        <label className="check"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Seulement ce qui reste à faire</label>
        <label className="check"><input type="checkbox" checked={withClosed} onChange={(e) => setWithClosed(e.target.checked)} /> Inclure les projets clos</label>
        {late > 0 && <span className="badge badge-danger">{late} jalon(s) en retard</span>}
        {lateTodos > 0 && <span className="badge badge-danger">{lateTodos} tâche(s) en retard</span>}
        <span className="tb-flex" />
        <span className="gp-legend small muted">
          <span><i className="gp-dot tl-todo" /> jalon à venir</span>
          <span><i className="gp-dot tl-late" /> en retard</span>
          <span><i className="gp-dot tl-done" /> atteint</span>
          {withTodos && <span><i className="gp-square" /> to-do</span>}
          <span><i className="gp-bar-sample gp-range-sample" /> jalon sur une période</span>
          <span><i className="gp-bar-sample" /> début → fin visée du projet</span>
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
            {rows.map((r) => {
              const p = r.project;
              const start = p?.startDate && p.startDate < to ? (p.startDate > from ? p.startDate : from) : '';
              const end = p?.targetDate && p.targetDate >= from ? (p.targetDate < to ? p.targetDate : to) : '';
              const hidden = r.jalons.filter((j) => !inWindow(j.date)).length + r.todos.filter((t) => !inWindow(t.dueDate)).length;
              return (
                <div key={p?.id ?? 'ma-todo'} className="gp-row">
                  <div className="gp-name">
                    {p ? (
                      <>
                        <HealthBadge health={p.health} withLabel={false} />
                        <Link to={`/projets/${p.id}?onglet=planning`} title={p.name}>{p.code ? `${p.code} · ` : ''}{p.name}</Link>
                      </>
                    ) : (
                      <Link to="/todo">✅ Ma to-do (hors projet)</Link>
                    )}
                    {hidden > 0 && <span className="muted small" title="Éléments hors de la période affichée">+{hidden}</span>}
                  </div>
                  <div className="gp-track">
                    {months.map((m) => <span key={m} className="gp-grid" style={{ left: `${pos(m)}%` }} />)}
                    {start && end && end > start && (
                      <span className="gp-bar" style={{ left: `${pos(start)}%`, width: `${pos(end) - pos(start)}%` }} title={`Du ${formatDate(p!.startDate)} au ${formatDate(p!.targetDate)}`} />
                    )}
                    {/* Jalons sur une période : une barre du début à la fin, le point marque la fin. */}
                    {r.jalons.filter((j) => j.startDate && j.startDate < to && j.date >= from).map((j) => {
                      const a = j.startDate > from ? j.startDate : from;
                      const b = j.date < to ? j.date : to;
                      return <span key={`p${j.id}`} className={`gp-range ${jalonClass(j)}`} style={{ left: `${pos(a)}%`, width: `${pos(b) - pos(a)}%` }} title={`${j.label} — ${jalonPeriod(j, formatDate)}`} />;
                    })}
                    {/* Libellés alternés au-dessus et en dessous de l'axe : deux jalons proches ne se chevauchent pas. */}
                    {r.jalons.filter((j) => inWindow(j.date)).map((j, i) => (
                      <span key={j.id} className={`gp-jalon ${jalonClass(j)} ${i % 2 ? 'gp-below' : 'gp-above'}${pos(j.date) > 85 ? ' gp-end' : ''}`} style={{ left: `${pos(j.date)}%` }} title={`${j.label} — ${jalonPeriod(j, formatDate)}${j.done ? ' (atteint)' : ''}`}>
                        <i className="gp-dot" />
                        <span className="gp-label">{j.label}</span>
                      </span>
                    ))}
                    {/* To-do : un petit carré à l'échéance, le détail au survol et dans la liste. */}
                    {r.todos.filter((t) => inWindow(t.dueDate)).map((t) => (
                      <span
                        key={t.id}
                        className={`gp-todo ${todoClass(t, today)}`}
                        style={{ left: `${pos(t.dueDate)}%` }}
                        title={`To-do : ${t.title} — ${formatDate(t.dueDate)}${t.assigneeId && t.assigneeId !== me.email ? ` (${name(t.assigneeId)})` : ''}${t.done ? ' (faite)' : ''}`}
                      >
                        <i className="gp-square" />
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
          <h2>Échéances de la période</h2>
          {[...byMonth].map(([month, list]) => (
            <div key={month} className="gp-month-block">
              <h3>{MONTHS[Number(month.slice(5, 7)) - 1]} {month.slice(0, 4)}</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Date</th>
                      <th>Jalon ou tâche</th>
                      <th>Projet</th>
                      <th>Glissement</th>
                      <th>État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((e) => (e.kind === 'jalon' ? <JalonRow key={e.jalon.id} j={e.jalon} project={e.project} /> : <TodoRow key={e.todo.id} t={e.todo} project={e.project} today={today} />))}
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

function JalonRow({ j, project }: { j: ProjectJalon; project: PlanningProject }) {
  const drift = jalonDrift(j);
  return (
    <tr className={j.done ? 'row-done' : ''}>
      <td><DueLabel date={j.date} done={j.done} /></td>
      <td>
        {j.label}
        {j.startDate && <div className="muted small">{jalonPeriod(j, formatDate)}</div>}
      </td>
      <td><Link to={`/projets/${project.id}?onglet=planning`}>{project.name}</Link></td>
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
}

function TodoRow({ t, project, today }: { t: PlanningTodo; project: PlanningProject | null; today: string }) {
  const { me } = useAuth();
  const { name } = useUsers();
  return (
    <tr className={t.done ? 'row-done' : ''}>
      <td><DueLabel date={t.dueDate} done={t.done} /></td>
      <td>
        <span className="badge badge-todo">To-do</span> {t.title}
        {t.assigneeId && t.assigneeId !== me.email && <div className="muted small">{name(t.assigneeId)}</div>}
      </td>
      <td>{project ? <Link to={`/projets/${project.id}?onglet=todo`}>{project.name}</Link> : <Link to="/todo">Ma to-do</Link>}</td>
      <td><span className="muted">—</span></td>
      <td>{t.done ? <span className="badge badge-ok">Faite</span> : todoLate(t, today) ? <span className="badge badge-danger">En retard</span> : <span className="badge">À faire</span>}</td>
    </tr>
  );
}
