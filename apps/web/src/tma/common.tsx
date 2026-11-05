import type { Breakdown } from '@samm/shared';

export const fmtH = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`;
export const fmtN = (n: number) => n.toLocaleString('fr-FR');

/** Écart avec le mois précédent (« +12 % »), ou rien si la référence est nulle. */
export function delta(cur: number, prev: number | undefined) {
  if (prev === undefined || prev === 0) return null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return <span className="muted small">{pct > 0 ? '+' : ''}{pct} % vs mois précédent</span>;
}

/** Barre horizontale proportionnelle (une seule série : la valeur est écrite à côté, la barre ne fait que l'illustrer). */
export function Bar({ value, max, title }: { value: number; max: number; title?: string }) {
  const pct = max > 0 ? Math.max(1, (value / max) * 100) : 0;
  return (
    <div className="hbar" title={title}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Tableau « libellé / barre / valeur » pour une répartition. */
export function BreakdownTable({ rows, unit, empty = 'Aucune donnée.', max = 12 }: { rows: Breakdown[]; unit: 'hours' | 'count'; empty?: string; max?: number }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  const value = (r: Breakdown) => (unit === 'hours' ? r.hours : r.count);
  const top = Math.max(...rows.map(value));
  const shown = rows.slice(0, max);
  const rest = rows.slice(max);
  return (
    <table className="table table-compact">
      <tbody>
        {shown.map((r) => (
          <tr key={r.key}>
            <td>{r.key}</td>
            <td className="bar-cell">
              <Bar value={value(r)} max={top} title={unit === 'hours' ? `${r.key} : ${fmtH(r.hours)} (${r.count} ticket(s))` : `${r.key} : ${r.count}`} />
            </td>
            <td className="num">{unit === 'hours' ? fmtH(r.hours) : fmtN(r.count)}</td>
            {unit === 'hours' && <td className="num muted small">{r.count} tk</td>}
          </tr>
        ))}
        {rest.length > 0 && (
          <tr>
            <td className="muted small">{rest.length} autre(s)</td>
            <td />
            <td className="num muted">{unit === 'hours' ? fmtH(rest.reduce((n, r) => n + r.hours, 0)) : fmtN(rest.reduce((n, r) => n + r.count, 0))}</td>
            {unit === 'hours' && <td />}
          </tr>
        )}
      </tbody>
    </table>
  );
}
