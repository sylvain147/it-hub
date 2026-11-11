import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CLOSED_PROJECT_STATUSES, isJalonLate, isMyProject, jalonDrift, jalonPeriod, type PlanningProject, type ProjectJalon } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, formatDate, Spinner } from '../components/ui';
import { DueLabel, HealthBadge } from './common';
import { MyProjectsCheck, useMyProjectsFilter } from './mine';

/** Trois vues seulement : le mois, le trimestre, l'année. */
const PERIODS = [
  { id: 'mois', label: 'Mois', months: 1 },
  { id: 'trimestre', label: 'Trimestre', months: 3 },
  { id: 'annee', label: 'Année', months: 12 },
] as const;
type PeriodId = (typeof PERIODS)[number]['id'];

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const DAY = 86400000;

/** Premier jour du mois de `iso`, décalé de `delta` mois. */
function monthStart(iso: string, delta = 0): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, delta: number): string {
  return new Date(Date.parse(iso) + delta * DAY).toISOString().slice(0, 10);
}

/** Fenêtre [from, to[ : le mois en cours, le trimestre qui commence ce mois-ci, ou l'année glissante (mois précédent compris). */
function windowOf(period: PeriodId, today: string, offset: number): { from: string; to: string } {
  const months = PERIODS.find((p) => p.id === period)!.months;
  const start = period === 'annee' ? -1 : 0;
  return { from: monthStart(today, start + months * offset), to: monthStart(today, start + months * (offset + 1)) };
}

/** Intitulé de la période : « novembre 2026 », « nov. 2026 – janv. 2027 ». */
function periodLabel(from: string, to: string): string {
  const last = addDays(to, -1);
  const m = (iso: string, short: boolean) => `${(short ? MONTHS_SHORT : MONTHS)[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  return from.slice(0, 7) === last.slice(0, 7) ? m(from, false) : `${m(from, true)} – ${m(last, true)}`;
}

/** Graduations : les lundis pour un mois, les mois au-delà. */
function ticksOf(period: PeriodId, from: string, to: string): { date: string; label: string }[] {
  const ticks: { date: string; label: string }[] = [];
  if (period === 'mois') {
    for (let d = from; d < to; d = addDays(d, 1)) if (new Date(d).getUTCDay() === 1) ticks.push({ date: d, label: `lun. ${Number(d.slice(8))}` });
    return ticks;
  }
  for (let m = from; m < to; m = monthStart(m, 1)) {
    const name = (period === 'annee' ? MONTHS_SHORT : MONTHS)[Number(m.slice(5, 7)) - 1]!;
    ticks.push({ date: m, label: m.slice(5, 7) === '01' ? `${name} ${m.slice(0, 4)}` : name });
  }
  return ticks;
}

const jalonLink = (p: PlanningProject, j: ProjectJalon) => `/projets/${p.id}?onglet=planning&jalon=${encodeURIComponent(j.id)}`;
const jalonState = (j: ProjectJalon) => (j.done ? 'done' : isJalonLate(j) ? 'late' : 'todo');

/** Hauteur d'une ligne d'étiquettes sur la frise (px). */
const LANE = 28;

/** Étiquette placée sur la frise : position et largeur en pixels, ligne attribuée pour ne pas chevaucher les autres. */
interface Placed {
  jalon: ProjectJalon;
  left: number;
  width: number;
  lane: number;
  range: boolean;
}

/**
 * Place les jalons d'un projet en étiquettes lisibles : un jalon ponctuel commence à sa date (ou finit à sa date près du
 * bord droit), un jalon sur une période couvre ses dates. Deux étiquettes qui se chevauchent passent sur des lignes
 * différentes.
 */
function layout(jalons: ProjectJalon[], x: (iso: string) => number, xEnd: (iso: string) => number, width: number): Placed[] {
  const lanes: number[] = [];
  return jalons.map((j) => {
    // Largeur du libellé (police de 12 px), avec le symbole d'état (⚠, ✓) et les marges.
    const text = Math.min(280, j.label.length * 7.3 + 24 + (j.done || isJalonLate(j) ? 18 : 0));
    let left: number;
    let w: number;
    const range = !!j.startDate;
    if (range) {
      left = Math.max(0, x(j.startDate));
      w = Math.max(xEnd(j.date) - left, 24);
    } else {
      w = text;
      left = x(j.date) + w > width ? Math.max(0, xEnd(j.date) - w) : x(j.date);
    }
    // Étiquette réservée en entier, même si la barre de la période est plus courte que son libellé.
    const end = left + Math.max(w, Math.min(text, width - left)) + 4;
    let lane = lanes.findIndex((busyUntil) => busyUntil <= left);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = end;
    return { jalon: j, left, width: w, lane, range };
  });
}

/** Largeur de la frise, suivie au redimensionnement de la fenêtre. */
function useWidth(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width || 800);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);
  return { ref, width };
}

/**
 * Planning : les jalons de tous les projets en cours sur une même frise (une ligne par projet, la période du projet en
 * fond), puis la liste des échéances de la période. Les jalons se saisissent dans l'onglet « Planning » de chaque projet.
 */
export function GlobalPlanningPage() {
  const { me } = useAuth();
  const { data, error, loading } = useLoad(() => api.planning(), []);
  const [period, setPeriodId] = useState<PeriodId>('trimestre');
  // Décalage en nombre de périodes (◀ ▶) ; 0 : la période qui contient aujourd'hui.
  const [offset, setOffset] = useState(0);
  const [mineOnly, setMineOnly] = useMyProjectsFilter();
  const today = new Date().toISOString().slice(0, 10);
  const { from, to } = windowOf(period, today, offset);
  const inWindow = (d: string) => d >= from && d < to;
  const track = useWidth(!!data?.length);
  // La colonne des noms est hors de la frise.
  const width = Math.max(track.width, 200);
  const min = Date.parse(from);
  const span = Date.parse(to) - min;
  const x = (d: string) => ((Date.parse(d) - min) / span) * width;
  const xEnd = (d: string) => (d < to ? x(addDays(d, 1)) : width);

  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((p) => !CLOSED_PROJECT_STATUSES.includes(p.status) && (!mineOnly || isMyProject(p, me.email)))
        .map((p) => ({ project: p, jalons: p.jalons.filter((j) => j.date).sort((a, b) => (a.startDate || a.date).localeCompare(b.startDate || b.date)) }))
        .filter((r) => r.jalons.length || r.project.startDate || r.project.targetDate)
        // Prochaine échéance d'abord, puis les projets sans échéance.
        .sort((a, b) => {
          const next = (r: typeof a) => r.jalons.find((j) => !j.done)?.date ?? '9999';
          return next(a).localeCompare(next(b)) || a.project.name.localeCompare(b.project.name, 'fr');
        }),
    [data, mineOnly, me.email],
  );
  const shown = rows.map((r) => ({ ...r, visible: r.jalons.filter((j) => j.date >= from && (j.startDate || j.date) < to) }));
  const entries = shown
    .flatMap((r) => r.jalons.filter((j) => inWindow(j.date)).map((j) => ({ jalon: j, project: r.project })))
    .sort((a, b) => a.jalon.date.localeCompare(b.jalon.date));
  const late = rows.reduce((n, r) => n + r.jalons.filter((j) => isJalonLate(j)).length, 0);
  const ticks = ticksOf(period, from, to);

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Planning des projets</h1>
          <p className="muted small">Les jalons des projets en cours. Ils se saisissent dans l’onglet « Planning » de chaque projet.</p>
        </div>
      </div>

      <div className="toolbar-row planning-toolbar">
        <div className="seg" role="group" aria-label="Période">
          {PERIODS.map((p) => (
            <button key={p.id} className={p.id === period ? 'on' : ''} onClick={() => { setPeriodId(p.id); setOffset(0); }}>{p.label}</button>
          ))}
        </div>
        <div className="planning-nav">
          <button className="btn btn-sm" onClick={() => setOffset((o) => o - 1)} aria-label="Période précédente">◀</button>
          <strong className="planning-period">{periodLabel(from, to)}</strong>
          <button className="btn btn-sm" onClick={() => setOffset((o) => o + 1)} aria-label="Période suivante">▶</button>
          {offset !== 0 && <button className="btn btn-sm btn-ghost" onClick={() => setOffset(0)}>Aujourd’hui</button>}
        </div>
        <span className="tb-flex" />
        {late > 0 && <span className="badge badge-danger">{late} jalon{late > 1 ? 's' : ''} en retard</span>}
        <MyProjectsCheck mine={mineOnly} setMine={setMineOnly} />
      </div>

      <ErrorBox error={error} />
      {loading && !data && <Spinner />}
      {data && !rows.length && (
        <EmptyState>{mineOnly ? 'Aucun jalon sur vos projets (chef de projet ou suivis). Décochez « Mes projets » pour voir toute l’équipe.' : 'Aucun jalon daté. Ajoutez les grandes dates dans l’onglet « Planning » de vos projets.'}</EmptyState>
      )}

      {rows.length > 0 && (
        <section className="card pl-card">
          <div className="pl">
            <div className="pl-row pl-head">
              <div className="pl-name" />
              <div className="pl-track" ref={track.ref}>
                {ticks.map((t) => <span key={t.date} className="pl-tick" style={{ left: x(t.date) }}>{t.label}</span>)}
              </div>
            </div>
            {shown.map(({ project: p, visible }) => {
              const placed = layout(visible, x, xEnd, width);
              const lanes = Math.max(1, ...placed.map((e) => e.lane + 1));
              const start = p.startDate && p.startDate < to ? (p.startDate > from ? p.startDate : from) : '';
              const end = p.targetDate && p.targetDate >= from ? (p.targetDate < to ? p.targetDate : addDays(to, -1)) : '';
              return (
                <div key={p.id} className="pl-row">
                  <div className="pl-name">
                    <HealthBadge health={p.health} withLabel={false} />
                    <Link to={`/projets/${p.id}?onglet=planning`} title={p.name}>{p.name}</Link>
                  </div>
                  <div className="pl-track" style={{ height: lanes * LANE + 12 }}>
                    {ticks.map((t) => <span key={t.date} className="pl-grid" style={{ left: x(t.date) }} />)}
                    {start && end && end >= start && (
                      <span className="pl-project" style={{ left: x(start), width: xEnd(end) - x(start) }} title={`Projet : ${p.startDate ? `du ${formatDate(p.startDate)} ` : ''}${p.targetDate ? `au ${formatDate(p.targetDate)}` : ''}`} />
                    )}
                    {inWindow(today) && <span className="pl-today" style={{ left: x(today) + (xEnd(today) - x(today)) / 2 }} />}
                    {placed.map(({ jalon: j, left, width: w, lane, range }) => (
                      <Link
                        key={j.id}
                        to={jalonLink(p, j)}
                        className={`pl-chip pl-${jalonState(j)}${range ? ' pl-range' : ''}`}
                        style={{ left, top: 6 + lane * LANE, ...(range ? { width: w } : { maxWidth: w }) }}
                        title={`${j.label} — ${jalonPeriod(j, formatDate)}${j.done ? ' (atteint)' : isJalonLate(j) ? ' (en retard)' : ''}`}
                      >
                        {j.done ? '✓ ' : isJalonLate(j) ? '⚠ ' : ''}
                        {j.label}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="pl-legend muted small">
            <span className="pl-chip pl-todo pl-sample">À venir</span>
            <span className="pl-chip pl-late pl-sample">⚠ En retard</span>
            <span className="pl-chip pl-done pl-sample">✓ Atteint</span>
            <span><i className="pl-project pl-sample-bar" /> Durée du projet</span>
          </p>
        </section>
      )}

      {entries.length > 0 && (
        <section className="card">
          <h2>Échéances : {periodLabel(from, to)}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 190 }}>Date</th>
                  <th>Jalon</th>
                  <th>Projet</th>
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => <JalonRow key={e.jalon.id} j={e.jalon} project={e.project} />)}
              </tbody>
            </table>
          </div>
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
        <Link to={jalonLink(project, j)}>{j.label}</Link>
        {j.startDate && <div className="muted small">{jalonPeriod(j, formatDate)}</div>}
      </td>
      <td><Link to={`/projets/${project.id}?onglet=planning`}>{project.name}</Link></td>
      <td>
        {j.done ? <span className="badge badge-ok">Atteint</span> : isJalonLate(j) ? <span className="badge badge-danger">En retard</span> : <span className="badge">À venir</span>}
        {drift > 0 && <span className="due-late small" title={`Date initiale : ${formatDate(j.initialDate)}`}> décalé de {drift} j</span>}
      </td>
    </tr>
  );
}
