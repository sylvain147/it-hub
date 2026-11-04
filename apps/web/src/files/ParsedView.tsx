import { useMemo, useState } from 'react';
import { decodeFile, parseFile, readRecord, writeXlsx, type CellValue, type FileSpec, type ParseResult, type RecordTypeSpec } from '@samm/shared';
import { download } from '../api';
import { VirtualList } from './VirtualList';
import type { LocalFile } from './local';

export interface Parsed {
  result: ParseResult;
  encoding: string;
  ms: number;
}

export function useParsed(spec: FileSpec | null, file: LocalFile | null): Parsed | null {
  return useMemo(() => {
    if (!spec || !file) return null;
    const t0 = performance.now();
    const { text, encoding } = decodeFile(file.bytes, spec.encoding);
    const result = parseFile(spec, text);
    return { result, encoding, ms: Math.round(performance.now() - t0) };
  }, [spec, file]);
}

const typeOf = (r: ParseResult, code: string | null) => (code ? r.spec.recordTypes.find((t) => t.code === code) ?? null : null);
const visibleFields = (t: RecordTypeSpec) => t.fields.map((f, i) => ({ f, i })).filter(({ f }) => !f.hidden);

// ---------------------------------------------------------------------------
// Synthèse
// ---------------------------------------------------------------------------

export function Summary({ parsed, fileName }: { parsed: Parsed; fileName: string }) {
  const r = parsed.result;
  const failed = r.checks.filter((c) => !c.ok);
  const anomalies = r.unknown.length + r.fieldErrorCount;
  const headers = r.spec.recordTypes.filter((t) => t.role === 'header' || t.role === 'trailer');
  return (
    <div className="summary">
      <div className="summary-stats">
        <div className="stat-mini">
          <span className="stat-label">Lignes</span>
          <strong>{r.lineCount.toLocaleString('fr-FR')}</strong>
        </div>
        {r.spec.recordTypes
          .filter((t) => (r.byType.get(t.code)?.length ?? 0) > 0 && t.role !== 'header' && t.role !== 'trailer')
          .slice(0, 6)
          .map((t) => (
            <div key={t.code} className="stat-mini">
              <span className="stat-label">{t.name}</span>
              <strong>{(r.byType.get(t.code)?.length ?? 0).toLocaleString('fr-FR')}</strong>
            </div>
          ))}
        <div className={`stat-mini ${anomalies ? 'stat-warn' : 'stat-ok'}`}>
          <span className="stat-label">Anomalies</span>
          <strong>{anomalies ? anomalies.toLocaleString('fr-FR') : '✓ aucune'}</strong>
        </div>
        {r.checks.length > 0 && (
          <div className={`stat-mini ${failed.length ? 'stat-warn' : 'stat-ok'}`}>
            <span className="stat-label">Contrôles</span>
            <strong>{failed.length ? `⚠ ${failed.length} en échec` : `✓ ${r.checks.length} OK`}</strong>
          </div>
        )}
      </div>
      {headers.map((t) =>
        (r.byType.get(t.code) ?? []).slice(0, 3).map((idx) => {
          const { values } = readRecord(r, idx);
          const shown = visibleFields(t).filter(({ f, i }) => f.type !== 'code' || f.values.length > 0 || i > 0).filter(({ i }) => values[i]?.display);
          if (!shown.length) return null;
          return (
            <div key={idx} className="summary-header">
              <span className="badge">{t.name}</span>
              {shown.map(({ f, i }) => (
                <span key={f.key} className="kv">
                  <span className="muted">{f.label} :</span> {values[i]!.display}
                </span>
              ))}
            </div>
          );
        }),
      )}
      {failed.map((c, i) => (
        <div key={i} className="alert alert-error">⚠ {c.label} (ligne {c.line}) : annoncé {c.expected ?? '?'}, constaté {c.actual}</div>
      ))}
      <div className="muted small">{fileName} · encodage {parsed.encoding} · lu en {parsed.ms} ms sur votre poste</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vue structurée (regroupements)
// ---------------------------------------------------------------------------

const PAGE = 50;

export function StructuredView({ result }: { result: ParseResult }) {
  const [shown, setShown] = useState(PAGE);
  const [q, setQ] = useState('');
  const roots = useMemo(() => {
    const all = result.records.map((rec, i) => ({ rec, i })).filter(({ rec }) => rec.type && rec.parent === null && typeOf(result, rec.type)?.role !== 'header' && typeOf(result, rec.type)?.role !== 'trailer');
    if (!q.trim()) return all.map((x) => x.i);
    const needle = q.toLowerCase();
    const matches = (i: number): boolean => result.records[i]!.raw.toLowerCase().includes(needle) || (result.children.get(i) ?? []).some(matches);
    return all.filter(({ i }) => matches(i)).map((x) => x.i);
  }, [result, q]);
  return (
    <div>
      <input className="input search" placeholder="Rechercher (n° de facture, référence, libellé…)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="muted small">{roots.length.toLocaleString('fr-FR')} élément(s)</div>
      {roots.slice(0, shown).map((i) => (
        <RecordCard key={i} result={result} index={i} depth={0} />
      ))}
      {roots.length > shown && (
        <button className="btn btn-ghost btn-block" onClick={() => setShown(shown + PAGE)}>
          Afficher {Math.min(PAGE, roots.length - shown)} de plus
        </button>
      )}
    </div>
  );
}

function RecordCard({ result, index, depth }: { result: ParseResult; index: number; depth: number }) {
  const [open, setOpen] = useState(false);
  const rec = result.records[index]!;
  const { type, values } = readRecord(result, index);
  const kids = result.children.get(index) ?? [];
  if (!type) return null;
  const fields = visibleFields(type);
  // Champs résumés : les premiers champs renseignés hors code de type.
  const headline = fields.filter(({ f, i }) => !(i === 0 && f.type === 'code' && !f.values.length) && values[i]?.display).slice(0, 5);
  const errors = values.filter((v) => v.error).length;
  const kidTypes = new Map<string, number>();
  for (const k of kids) kidTypes.set(result.records[k]!.type ?? '?', (kidTypes.get(result.records[k]!.type ?? '?') ?? 0) + 1);
  return (
    <div className={`rec depth-${Math.min(depth, 3)}`}>
      <button className="rec-head" onClick={() => setOpen(!open)}>
        <span className="rec-toggle">{open ? '▾' : '▸'}</span>
        <span className="badge">{type.name}</span>
        {headline.map(({ f, i }) => (
          <span key={f.key} className="kv">
            <span className="muted">{f.label} :</span> {values[i]!.display}
          </span>
        ))}
        {kids.length > 0 && (
          <span className="muted small">
            {[...kidTypes.entries()].map(([code, n]) => `${n} × ${typeOf(result, code)?.name ?? code}`).join(', ')}
          </span>
        )}
        {errors > 0 && <span className="badge prio-0">{errors} erreur(s)</span>}
        <span className="muted small rec-line">l.{rec.line}</span>
      </button>
      {open && (
        <div className="rec-body">
          <div className="fields-grid">
            {fields.map(({ f, i }) => (
              <div key={f.key} className={`fg${values[i]!.error ? ' fg-err' : ''}`} title={`${f.description ? f.description + '\n' : ''}Positions ${f.start}${f.length ? '-' + (f.start + f.length - 1) : ''} · brut « ${values[i]!.raw} »${values[i]!.error ? '\n⚠ ' + values[i]!.error : ''}`}>
                <span className="fg-label">{f.label}</span>
                <span className="fg-value">{values[i]!.display || <span className="muted">—</span>}</span>
              </div>
            ))}
          </div>
          {kids.map((k) => (
            <RecordCard key={k} result={result} index={k} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tableaux par type d'enregistrement
// ---------------------------------------------------------------------------

export function TablesView({ result }: { result: ParseResult }) {
  const available = result.spec.recordTypes.filter((t) => (result.byType.get(t.code)?.length ?? 0) > 0);
  const defaultType = available.find((t) => t.role === 'detail') ?? available.find((t) => t.role === 'group') ?? available[0];
  const [code, setCode] = useState(defaultType?.code ?? '');
  const [q, setQ] = useState('');
  const type = typeOf(result, code);
  const rows = useMemo(() => {
    const idx = result.byType.get(code) ?? [];
    if (!q.trim()) return idx;
    const needle = q.toLowerCase();
    return idx.filter((i) => result.records[i]!.raw.toLowerCase().includes(needle));
  }, [result, code, q]);
  if (!type) return <p className="muted">Aucun enregistrement.</p>;
  const cols = visibleFields(type);
  const parentType = type.parent ? typeOf(result, type.parent) : null;
  const parentKey = parentType ? visibleFields(parentType).find(({ f, i }) => i > 0 || f.type !== 'code') : undefined;
  const width = 70 + (parentKey ? 160 : 0) + cols.length * 150;
  return (
    <div>
      <div className="filters">
        <select className="input input-auto" value={code} onChange={(e) => setCode(e.target.value)}>
          {available.map((t) => (
            <option key={t.code} value={t.code}>
              {t.name} ({result.byType.get(t.code)!.length.toLocaleString('fr-FR')})
            </option>
          ))}
        </select>
        <input className="input" placeholder="Filtrer les lignes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small nowrap">{rows.length.toLocaleString('fr-FR')} ligne(s)</span>
      </div>
      <div className="grid-table" style={{ width: '100%' }}>
        <div className="grid-row grid-head" style={{ minWidth: width }}>
          <div className="gc gc-line">Ligne</div>
          {parentKey && <div className="gc">{parentType!.name}</div>}
          {cols.map(({ f }) => (
            <div key={f.key} className="gc" title={f.description}>{f.label}</div>
          ))}
        </div>
        <VirtualList
          count={rows.length}
          rowHeight={30}
          height={Math.min(560, rows.length * 30 + 4)}
          className="grid-body"
          render={(n) => {
            const i = rows[n]!;
            const { values } = readRecord(result, i);
            const parentIdx = result.records[i]!.parent;
            const pv = parentKey && parentIdx != null ? readRecord(result, parentIdx).values[parentKey.i]?.display : '';
            return (
              <div className="grid-row" style={{ minWidth: width }}>
                <div className="gc gc-line">{result.records[i]!.line}</div>
                {parentKey && <div className="gc">{pv}</div>}
                {cols.map(({ f, i: fi }) => {
                  const v = values[fi]!;
                  return (
                    <div key={f.key} className={`gc${v.error ? ' gc-err' : ''}${typeof v.value === 'number' ? ' gc-num' : ''}`} title={v.error ? `⚠ ${v.error} — brut « ${v.raw} »` : v.display}>
                      {v.display}
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Anomalies et contenu brut
// ---------------------------------------------------------------------------

export function AnomaliesView({ result }: { result: ParseResult }) {
  const failed = result.checks.filter((c) => !c.ok);
  if (!result.unknown.length && !result.fieldErrorCount && !failed.length) return <div className="empty">✓ Aucune anomalie : toutes les lignes sont reconnues, toutes les valeurs sont lisibles et les contrôles sont bons.</div>;
  return (
    <div className="anomalies">
      {failed.length > 0 && (
        <>
          <h3>Contrôles en échec</h3>
          {failed.map((c, i) => (
            <div key={i} className="anomaly">Ligne {c.line} — {c.label} : annoncé {c.expected ?? '?'}, constaté {c.actual}</div>
          ))}
        </>
      )}
      {result.unknown.length > 0 && (
        <>
          <h3>Lignes non reconnues ({result.unknown.length.toLocaleString('fr-FR')})</h3>
          {result.unknown.slice(0, 200).map((i) => (
            <div key={i} className="anomaly mono">
              <span className="muted">l.{result.records[i]!.line}</span> {result.records[i]!.raw}
            </div>
          ))}
        </>
      )}
      {result.fieldErrorCount > 0 && (
        <>
          <h3>Valeurs illisibles ({result.fieldErrorCount.toLocaleString('fr-FR')})</h3>
          {result.fieldErrors.slice(0, 300).map((e, k) => {
            const rec = result.records[e.record]!;
            const t = typeOf(result, rec.type);
            const f = t?.fields.find((x) => x.key === e.field);
            const v = readRecord(result, e.record).values[t?.fields.indexOf(f!) ?? -1];
            return (
              <div key={k} className="anomaly">
                <span className="muted">l.{rec.line}</span> {t?.name} › <strong>{f?.label ?? e.field}</strong> : {e.message} — valeur lue « <span className="mono">{v?.raw}</span> »
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

const TYPE_COLORS = ['#e0ecf8', '#fdebd0', '#e8f6e9', '#f4e6f7', '#fff6cc', '#e3f2f1', '#fbe4e6', '#ececec'];

export function RawView({ result }: { result: ParseResult }) {
  const colors = new Map(result.spec.recordTypes.map((t, i) => [t.code, TYPE_COLORS[i % TYPE_COLORS.length]!]));
  return (
    <div>
      <div className="legend">
        {result.spec.recordTypes.map((t) => (
          <span key={t.code} className="legend-item" style={{ background: colors.get(t.code) }}>{t.name}</span>
        ))}
        <span className="legend-item legend-unknown">Non reconnue</span>
      </div>
      <VirtualList
        count={result.records.length}
        rowHeight={20}
        height={560}
        className="raw-view"
        render={(i) => {
          const rec = result.records[i]!;
          return (
            <div className={`raw-line${rec.type ? '' : ' raw-unknown'}`} style={{ background: rec.type ? colors.get(rec.type) : undefined }} title={typeOf(result, rec.type)?.name ?? 'Non reconnue'}>
              <span className="raw-no">{rec.line}</span>
              {rec.raw}
            </div>
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export Excel
// ---------------------------------------------------------------------------

export function exportToExcel(result: ParseResult, fileName: string) {
  const sheets: { name: string; rows: CellValue[][] }[] = [];
  for (const t of result.spec.recordTypes) {
    const idx = result.byType.get(t.code) ?? [];
    if (!idx.length) continue;
    const cols = visibleFields(t);
    const rows: CellValue[][] = [['Ligne', ...(t.parent ? ['Ligne parente'] : []), ...cols.map(({ f }) => f.label)]];
    for (const i of idx) {
      const { values } = readRecord(result, i);
      const parent = result.records[i]!.parent;
      rows.push([
        result.records[i]!.line,
        ...(t.parent ? [parent != null ? result.records[parent]!.line : null] : []),
        ...cols.map(({ f, i: fi }) => {
          const v = values[fi]!;
          if (v.error) return v.raw.trim();
          if (typeof v.value === 'number' && (f.type === 'decimal' || (f.type === 'integer' && !f.values.length))) return v.value;
          return v.display;
        }),
      ]);
    }
    sheets.push({ name: t.name, rows });
  }
  const anomalies: CellValue[][] = [['Ligne', 'Anomalie', 'Détail']];
  for (const c of result.checks.filter((x) => !x.ok)) anomalies.push([c.line, 'Contrôle en échec', `${c.label} : annoncé ${c.expected ?? '?'}, constaté ${c.actual}`]);
  for (const i of result.unknown) anomalies.push([result.records[i]!.line, 'Ligne non reconnue', result.records[i]!.raw]);
  for (const e of result.fieldErrors) anomalies.push([result.records[e.record]!.line, 'Valeur illisible', `${e.field} : ${e.message}`]);
  if (anomalies.length > 1) sheets.push({ name: 'Anomalies', rows: anomalies });
  const blob = new Blob([writeXlsx(sheets) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  download(url, `${fileName.replace(/\.[^.]+$/, '')}.xlsx`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
