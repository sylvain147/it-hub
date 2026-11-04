import { useState } from 'react';
import {
  ENCODINGS,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  FILE_FORMATS,
  FILE_FORMAT_LABELS,
  RECORD_ROLES,
  RECORD_ROLE_LABELS,
  type FieldSpec,
  type FileSpec,
  type RecordTypeSpec,
} from '@samm/shared';
import { Modal } from '../components/ui';

interface Props {
  spec: FileSpec;
  onChange: (s: FileSpec) => void;
  editable: boolean;
  /** Nombre de lignes par type dans le fichier de test (aide à la lecture). */
  counts?: Map<string, number>;
}

const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

export function SpecEditor({ spec, onChange, editable, counts }: Props) {
  const [open, setOpen] = useState<string | null>(spec.recordTypes[0]?.code ?? null);
  const set = <K extends keyof FileSpec>(k: K, v: FileSpec[K]) => onChange({ ...spec, [k]: v });
  const setType = (code: string, patch: Partial<RecordTypeSpec>) => set('recordTypes', spec.recordTypes.map((t) => (t.code === code ? { ...t, ...patch } : t)));
  const fixed = spec.format === 'fixed';

  return (
    <div className="spec-editor">
      <section className="card">
        <h2>Format général</h2>
        <div className="form-grid form-grid-4">
          <label className="field">
            <span>Format</span>
            <select className="input" disabled={!editable} value={spec.format} onChange={(e) => set('format', e.target.value as FileSpec['format'])}>
              {FILE_FORMATS.map((f) => (
                <option key={f} value={f}>{FILE_FORMAT_LABELS[f]}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Encodage</span>
            <select className="input" disabled={!editable} value={spec.encoding} onChange={(e) => set('encoding', e.target.value as FileSpec['encoding'])}>
              {ENCODINGS.map((f) => (
                <option key={f} value={f}>{f === 'utf-8' ? 'UTF-8' : 'ANSI (Windows-1252)'}</option>
              ))}
            </select>
          </label>
          {!fixed && (
            <label className="field">
              <span>Séparateur</span>
              <input className="input mono" disabled={!editable} value={spec.delimiter === '\t' ? '\\t' : spec.delimiter} onChange={(e) => set('delimiter', e.target.value === '\\t' ? '\t' : e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Lignes ignorées au début</span>
            <input className="input" type="number" min={0} disabled={!editable} value={spec.skipLines} onChange={(e) => set('skipLines', num(e.target.value))} />
          </label>
          <label className="field">
            <span>Nom de fichier (motif)</span>
            <input className="input mono" disabled={!editable} placeholder="*_facture_a_plat*.txt" value={spec.fileNamePattern} onChange={(e) => set('fileNamePattern', e.target.value)} />
          </label>
        </div>
      </section>

      <h2 className="section-h">Types de ligne ({spec.recordTypes.length})</h2>
      {spec.recordTypes.map((t) => (
        <section key={t.code} className="card rt">
          <button className="rt-head" onClick={() => setOpen(open === t.code ? null : t.code)}>
            <span className="rec-toggle">{open === t.code ? '▾' : '▸'}</span>
            <span className="badge mono">{t.code}</span>
            <strong>{t.name}</strong>
            <span className="muted small">{RECORD_ROLE_LABELS[t.role]}{t.parent ? ` · rattaché à ${spec.recordTypes.find((p) => p.code === t.parent)?.name ?? t.parent}` : ''}</span>
            <span className="muted small">{t.fields.length} champ(s)</span>
            {counts && <span className={`badge ${counts.get(t.code) ? 'status-valide' : 'status-archive'}`}>{counts.get(t.code) ?? 0} ligne(s) dans le test</span>}
          </button>
          {open === t.code && <RecordTypeEditor spec={spec} type={t} editable={editable} onChange={(patch) => setType(t.code, patch)} onDelete={() => set('recordTypes', spec.recordTypes.filter((x) => x.code !== t.code))} />}
        </section>
      ))}
      {editable && (
        <button
          className="btn btn-ghost"
          onClick={() => {
            let code = 'nouveau';
            for (let i = 2; spec.recordTypes.some((t) => t.code === code); i++) code = `nouveau_${i}`;
            set('recordTypes', [...spec.recordTypes, { code, name: 'Nouveau type de ligne', description: '', role: 'other', match: [{ start: 1, length: 2, value: '' }], parent: null, fields: [] }]);
            setOpen(code);
          }}
        >
          + Ajouter un type de ligne
        </button>
      )}

      <h2 className="section-h">Contrôles ({spec.checks.length})</h2>
      <section className="card">
        {!spec.checks.length ? (
          <p className="muted small">Aucun contrôle. Demandez à l’assistant d’en ajouter (ex. « vérifie que le nombre de factures de la ligne 99 correspond »).</p>
        ) : (
          <table className="table table-compact">
            <tbody>
              {spec.checks.map((c, i) => (
                <tr key={i}>
                  <td>{c.label}</td>
                  <td className="muted small">
                    {c.kind === 'count' ? 'nombre de' : `somme de ${c.targetField} sur`} {c.targetRecords.join(', ')} = {c.expectedRecord}.{c.expectedField}
                    {c.blockStart ? ` (bloc ouvert par ${c.blockStart})` : ''}
                  </td>
                  <td>{editable && <button className="btn-icon danger" title="Supprimer" onClick={() => set('checks', spec.checks.filter((_, j) => j !== i))}>🗑</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function RecordTypeEditor({ spec, type, editable, onChange, onDelete }: { spec: FileSpec; type: RecordTypeSpec; editable: boolean; onChange: (p: Partial<RecordTypeSpec>) => void; onDelete: () => void }) {
  const [valuesFor, setValuesFor] = useState<FieldSpec | null>(null);
  const fixed = spec.format === 'fixed';
  const setField = (key: string, patch: Partial<FieldSpec>) => onChange({ fields: type.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)) });
  const nextStart = type.fields.reduce((n, f) => Math.max(n, f.start + (fixed ? f.length : 1)), 1);
  return (
    <div className="rt-body">
      <div className="form-grid form-grid-4">
        <label className="field">
          <span>Nom</span>
          <input className="input" disabled={!editable} value={type.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Rôle</span>
          <select className="input" disabled={!editable} value={type.role} onChange={(e) => onChange({ role: e.target.value as RecordTypeSpec['role'] })}>
            {RECORD_ROLES.map((r) => (
              <option key={r} value={r}>{RECORD_ROLE_LABELS[r]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Rattaché à</span>
          <select className="input" disabled={!editable} value={type.parent ?? ''} onChange={(e) => onChange({ parent: e.target.value || null })}>
            <option value="">—</option>
            {spec.recordTypes
              .filter((t) => t.code !== type.code)
              .map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
          </select>
        </label>
        <div className="field">
          <span>Reconnue quand</span>
          {type.match.map((m, i) => (
            <div key={i} className="match-row">
              {fixed ? 'pos.' : 'col.'}
              <input className="input input-xs" type="number" min={1} disabled={!editable} value={m.start} onChange={(e) => onChange({ match: type.match.map((x, j) => (j === i ? { ...x, start: Math.max(1, num(e.target.value)) } : x)) })} />
              {fixed && (
                <>
                  long.
                  <input className="input input-xs" type="number" min={1} disabled={!editable} value={m.length} onChange={(e) => onChange({ match: type.match.map((x, j) => (j === i ? { ...x, length: num(e.target.value) } : x)) })} />
                </>
              )}
              =
              <input className="input input-sm mono" disabled={!editable} value={m.value} onChange={(e) => onChange({ match: type.match.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
            </div>
          ))}
          {!type.match.length && <span className="muted small">toujours (type par défaut)</span>}
        </div>
      </div>
      {type.description && <p className="muted small">{type.description}</p>}
      <div className="table-wrap">
        <table className="table table-compact fields-table">
          <thead>
            <tr>
              <th>{fixed ? 'Position' : 'Colonne'}</th>
              {fixed && <th>Long.</th>}
              <th>Libellé</th>
              <th>Type</th>
              <th>Format / décimales</th>
              <th>Libellés des codes</th>
              <th title="Masquer dans les tableaux">Masqué</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {type.fields.map((f) => (
              <tr key={f.key} className={f.hidden ? 'row-hidden' : ''}>
                <td>
                  <input className="input input-xs" type="number" min={1} disabled={!editable} value={f.start} onChange={(e) => setField(f.key, { start: Math.max(1, num(e.target.value)) })} />
                  {fixed && <span className="muted small"> → {f.start + f.length - 1}</span>}
                </td>
                {fixed && (
                  <td>
                    <input className="input input-xs" type="number" min={0} disabled={!editable} value={f.length} onChange={(e) => setField(f.key, { length: num(e.target.value) })} />
                  </td>
                )}
                <td>
                  <input className="input input-sm" disabled={!editable} value={f.label} title={f.description} onChange={(e) => setField(f.key, { label: e.target.value })} />
                </td>
                <td>
                  <select className="input input-sm" disabled={!editable} value={f.type} onChange={(e) => setField(f.key, { type: e.target.value as FieldSpec['type'] })}>
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </td>
                <td>
                  {(f.type === 'date' || f.type === 'time' || f.type === 'datetime') && (
                    <input className="input input-sm mono" disabled={!editable} placeholder="YYYYMMDD" value={f.dateFormat} onChange={(e) => setField(f.key, { dateFormat: e.target.value })} />
                  )}
                  {f.type === 'decimal' && (
                    <span className="nowrap">
                      <input className="input input-xs" type="number" min={0} max={10} disabled={!editable} value={f.impliedDecimals} onChange={(e) => setField(f.key, { impliedDecimals: Math.min(10, num(e.target.value)) })} /> déc. implicites
                    </span>
                  )}
                </td>
                <td>
                  <button className="btn-link small" onClick={() => setValuesFor(f)}>{f.values.length ? `${f.values.length} libellé(s)` : editable ? 'ajouter' : '—'}</button>
                </td>
                <td>
                  <input type="checkbox" disabled={!editable} checked={f.hidden} onChange={(e) => setField(f.key, { hidden: e.target.checked })} />
                </td>
                <td>{editable && <button className="btn-icon danger" title="Supprimer le champ" onClick={() => onChange({ fields: type.fields.filter((x) => x.key !== f.key) })}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && (
        <div className="row-actions">
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              let key = 'champ';
              for (let i = 2; type.fields.some((f) => f.key === key); i++) key = `champ_${i}`;
              onChange({ fields: [...type.fields, { key, label: 'Nouveau champ', start: nextStart, length: fixed ? 1 : 0, type: 'text', impliedDecimals: 0, dateFormat: '', values: [], description: '', hidden: false }] });
            }}
          >
            + Ajouter un champ
          </button>
          <span className="tb-flex" />
          <button className="btn btn-sm danger-text" onClick={() => confirm(`Supprimer le type de ligne « ${type.name} » ?`) && onDelete()}>Supprimer ce type de ligne</button>
        </div>
      )}
      {valuesFor && (
        <ValuesDialog
          field={valuesFor}
          editable={editable}
          onClose={() => setValuesFor(null)}
          onSave={(values) => {
            setField(valuesFor.key, { values });
            setValuesFor(null);
          }}
        />
      )}
    </div>
  );
}

function ValuesDialog({ field, editable, onClose, onSave }: { field: FieldSpec; editable: boolean; onClose: () => void; onSave: (v: FieldSpec['values']) => void }) {
  const [text, setText] = useState(field.values.map((v) => `${v.code} = ${v.label}`).join('\n'));
  return (
    <Modal
      title={`Libellés des codes — ${field.label}`}
      onClose={onClose}
      footer={
        editable ? (
          <>
            <button className="btn" onClick={onClose}>Annuler</button>
            <button
              className="btn btn-primary"
              onClick={() =>
                onSave(
                  text
                    .split('\n')
                    .map((l) => /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(l))
                    .filter((m): m is RegExpExecArray => !!m)
                    .map((m) => ({ code: m[1]!, label: m[2]! })),
                )
              }
            >
              Valider
            </button>
          </>
        ) : undefined
      }
    >
      <p className="muted small">Une ligne par code, sous la forme « CODE = Libellé ». L’écran de lecture affiche alors « Libellé (CODE) ».</p>
      <textarea className="input mono" rows={12} readOnly={!editable} value={text} onChange={(e) => setText(e.target.value)} placeholder={'ESS = La Poste Essentiel\nCOL = Colissimo'} />
    </Modal>
  );
}
