/**
 * Graphiques de la revue de sprint (HTML/SVG, sans bibliothèque).
 *
 * Couleurs des groupes de statut : ordre d'empilement fixe (terminé → à faire), palette validée pour la
 * séparation des couleurs (y compris daltonisme) sur les paires adjacentes. Les valeurs sont toujours écrites
 * en texte (légendes avec effectifs, étiquettes de fin de barre) et le tableau des tickets sert de vue détaillée.
 */
import { useState } from 'react';
import { SPRINT_GROUPS, SPRINT_GROUP_LABELS, shortDay, type SprintGroup, type SprintReport } from '@samm/shared';

const fmt = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

export function Swatch({ group }: { group: SprintGroup | 'sorti' }) {
  return <span className={`sw sw-${group}`} aria-hidden />;
}

/** Légende des groupes présents, avec leur effectif. */
export function GroupLegend({ counts, unit = '' }: { counts: Partial<Record<SprintGroup, number>>; unit?: string }) {
  return (
    <div className="viz-legend">
      {SPRINT_GROUPS.filter((g) => counts[g]).map((g) => (
        <span key={g} className="viz-legend-item">
          <Swatch group={g} /> {SPRINT_GROUP_LABELS[g]} <strong>{fmt(counts[g]!)}{unit}</strong>
        </span>
      ))}
    </div>
  );
}

/** Barre empilée (100 % ou proportionnelle à `max`). */
function StackBar({ parts, max, title }: { parts: { group: SprintGroup; value: number }[]; max: number; title: (g: SprintGroup, v: number) => string }) {
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div className="stack">
      {shown.map((p) => (
        <div key={p.group} className={`stack-seg sw-${p.group}`} style={{ width: `${(p.value / max) * 100}%` }} title={title(p.group, p.value)}>
          {p.value / max >= 0.08 && <span>{fmt(p.value)}</span>}
        </div>
      ))}
    </div>
  );
}

export function ProgressChart({ r }: { r: SprintReport }) {
  const total = r.counts.active;
  const pct = total ? Math.round((r.counts.done / total) * 100) : 0;
  return (
    <div>
      <div className="viz-hero">
        <strong>{pct} %</strong> <span className="muted">des tickets actifs clôturés</span>
      </div>
      <StackBar
        parts={r.byGroup.map((g) => ({ group: g.group, value: g.count }))}
        max={Math.max(1, total)}
        title={(g, v) => `${SPRINT_GROUP_LABELS[g]} : ${v} ticket(s) — ${r.byGroup.find((x) => x.group === g)!.statuses.join(', ')}`}
      />
      <GroupLegend counts={Object.fromEntries(r.byGroup.map((g) => [g.group, g.count]))} />
    </div>
  );
}

export function PeopleChart({ r }: { r: SprintReport }) {
  const max = Math.max(1, ...r.byAssignee.map((p) => p.total));
  return (
    <div className="viz-rows">
      {r.byAssignee.map((p) => (
        <div key={p.assignee} className="viz-row">
          <span className="viz-row-label" title={p.assignee}>{p.assignee}</span>
          <div className="viz-row-bar">
            <div style={{ width: `${(p.total / max) * 100}%` }}>
              <StackBar
                parts={SPRINT_GROUPS.map((g) => ({ group: g, value: p.groups[g] }))}
                max={p.total}
                title={(g, v) => `${p.assignee} — ${SPRINT_GROUP_LABELS[g]} : ${v} ticket(s)`}
              />
            </div>
          </div>
          <span className="viz-row-value">{p.total} <span className="muted small">· {fmt(p.points)} SP</span></span>
        </div>
      ))}
      <GroupLegend counts={Object.fromEntries(SPRINT_GROUPS.map((g) => [g, r.byAssignee.reduce((n, p) => n + p.groups[g], 0)]))} />
    </div>
  );
}

/** Barres horizontales simples, une couleur par groupe (identité), valeur écrite en bout de barre. */
function GroupBars({ rows, unit }: { rows: { key: string; group: SprintGroup | 'sorti'; label: string; value: number; title: string }[]; unit: string }) {
  const max = Math.max(1e-9, ...rows.map((x) => x.value));
  return (
    <div className="viz-rows">
      {rows.map((x) => (
        <div key={x.key} className="viz-row" title={x.title}>
          <span className="viz-row-label">{x.label}</span>
          <div className="viz-row-bar">
            <div className={`bar sw-${x.group}`} style={{ width: `${x.value ? Math.max(1.5, (x.value / max) * 100) : 0}%` }} />
          </div>
          <span className="viz-row-value">{fmt(x.value)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

export function PointsChart({ r }: { r: SprintReport }) {
  const rows: { key: string; group: SprintGroup | 'sorti'; label: string; value: number; title: string }[] = r.byGroup
    .filter((g) => g.count)
    .map((g) => ({ key: g.group, group: g.group, label: SPRINT_GROUP_LABELS[g.group], value: g.points, title: `${SPRINT_GROUP_LABELS[g.group]} : ${fmt(g.points)} SP sur ${g.count} ticket(s)` }));
  if (r.points.removed) rows.push({ key: 'sorti', group: 'sorti', label: 'Sorti du sprint', value: r.points.removed, title: `${fmt(r.points.removed)} SP retirés du sprint` });
  return <GroupBars rows={rows} unit=" SP" />;
}

export function TimeChart({ r }: { r: SprintReport }) {
  return (
    <GroupBars
      rows={r.timeByGroup.map((t) => ({ key: t.group, group: t.group, label: SPRINT_GROUP_LABELS[t.group], value: t.share, title: `${SPRINT_GROUP_LABELS[t.group]} : ${t.share} % (${fmt(t.days)} jours-ticket)` }))}
      unit=" %"
    />
  );
}

// ---------------------------------------------------------------------------
// Périmètre et clôtures jour par jour
// ---------------------------------------------------------------------------

const W = 640;
const H = 230;
const PAD = { l: 30, r: 12, t: 12, b: 26 };

export function ScopeChart({ r }: { r: SprintReport }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = r.timeline;
  if (pts.length < 2) return <p className="muted small">Le sprint vient de commencer : pas encore d’évolution à montrer.</p>;
  const yMax = Math.max(4, ...pts.map((p) => p.active));
  const step = yMax <= 8 ? 2 : yMax <= 20 ? 5 : 10;
  const top = Math.ceil(yMax / step) * step;
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (i / (pts.length - 1)) * iw;
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const stepPath = (vals: number[]) => vals.map((v, i) => (i === 0 ? `M${x(0)},${y(v)}` : `H${x(i)}V${y(v)}`)).join('');
  const done = pts.map((p) => p.done);
  const doneArea = `${stepPath(done)}V${y(0)}H${x(0)}Z`;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const labelEvery = Math.ceil(pts.length / 8);
  const h = hover === null ? null : pts[hover]!;

  return (
    <div className="scope-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Périmètre actif et tickets clôturés du ${shortDay(pts[0]!.day)} au ${shortDay(pts.at(-1)!.day)}`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="viz-grid" />
            <text x={PAD.l - 6} y={y(t) + 4} className="viz-axis" textAnchor="end">{t}</text>
          </g>
        ))}
        {pts.map((p, i) => ((i % labelEvery === 0 && pts.length - 1 - i >= labelEvery / 2) || i === pts.length - 1 ? <text key={p.day} x={x(i)} y={H - 6} className="viz-axis" textAnchor="middle">{shortDay(p.day)}</text> : null))}
        <path d={doneArea} className="scope-done" />
        <path d={stepPath(pts.map((p) => p.active))} className="scope-line" />
        {pts.map((p, i) => (p.events.length ? <circle key={p.day} cx={x(i)} cy={y(p.active)} r={4} className="scope-event" /> : null))}
        {h && hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="viz-cross" />}
        {pts.map((p, i) => (
          <rect key={p.day} x={x(i) - iw / (pts.length - 1) / 2} y={PAD.t} width={iw / (pts.length - 1)} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {h && hover !== null && (
        <div className="viz-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <strong>{shortDay(h.day)}</strong>
          <div>Périmètre actif : {h.active}</div>
          <div>Clôturés : {h.done}</div>
          {h.events.map((e) => <div key={e} className="muted">{e.startsWith('+') ? 'Ajout' : 'Retrait'} {e.slice(2)}</div>)}
        </div>
      )}
      <div className="viz-legend">
        <span className="viz-legend-item"><span className="sw-line" aria-hidden /> Périmètre actif</span>
        <span className="viz-legend-item"><Swatch group="termine" /> Clôturés (cumul)</span>
        <span className="viz-legend-item"><span className="sw-event" aria-hidden /> Ajout ou retrait</span>
      </div>
    </div>
  );
}
