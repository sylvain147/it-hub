import {
  MAJOR_VERSION_STATUSES,
  PROJECT_PHASES,
  PROJECT_PHASE_LABELS,
  type CdcMeta,
  type CdcStatus,
  type Jalon,
  type ProjectPhase,
} from '@samm/shared';
import { useSettings } from '../settings/context';
import { PrestatairePicker } from '../settings/PrestatairePicker';

const newJalonId = () => Math.random().toString(36).slice(2, 10);

export function MetaForm({ meta, onChange, editable }: { meta: CdcMeta; onChange: (m: CdcMeta) => void; editable: boolean }) {
  const { options, lists } = useSettings();
  const set = <K extends keyof CdcMeta>(k: K, v: CdcMeta[K]) => onChange({ ...meta, [k]: v });
  const setJalon = (id: string, patch: Partial<Jalon>) => set('jalons', meta.jalons.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  return (
    <section className="card meta">
      <div className="form-grid">
        <label className="field span-2">
          <span>Titre *</span>
          <input className="input input-title" value={meta.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} />
        </label>
        <label className="field">
          <span>Statut *</span>
          <select className="input" value={meta.status} disabled={!editable} onChange={(e) => set('status', e.target.value as CdcStatus)}>
            {options('cdc', meta.status).map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
                {MAJOR_VERSION_STATUSES.includes(s.key as CdcStatus) ? ' (version majeure)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Phase du projet</span>
          <select className="input" value={meta.phase ?? ''} disabled={!editable} onChange={(e) => set('phase', (e.target.value || null) as ProjectPhase | null)}>
            <option value="">—</option>
            {PROJECT_PHASES.map((p) => (
              <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Prestataire</span>
          <PrestatairePicker by="name" value={meta.prestataire} disabled={!editable} emptyLabel="—" onChange={(p) => set('prestataire', p?.name ?? '')} />
        </div>
        <label className="field">
          <span>Projet</span>
          <input className="input" value={meta.projet} disabled={!editable} onChange={(e) => set('projet', e.target.value)} />
        </label>
        <label className="field">
          <span>Estimation (jours/homme)</span>
          <input
            className="input"
            type="number"
            min={0}
            step={0.5}
            value={meta.estimationJours ?? ''}
            disabled={!editable}
            onChange={(e) => set('estimationJours', e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        <div className="field span-2">
          <span>Échéance cible</span>
          <div className="jalons">
            {meta.jalons.map((j) => (
              <div key={j.id} className="jalon">
                <input className="input" list="cdc-jalon-labels" placeholder="Jalon (ex. Testing phase 1, Production)" value={j.label} disabled={!editable} onChange={(e) => setJalon(j.id, { label: e.target.value })} />
                <input className="input input-date" type="date" value={j.date} disabled={!editable} onChange={(e) => setJalon(j.id, { date: e.target.value })} />
                {editable && (
                  <button className="btn-icon" title="Retirer ce jalon" onClick={() => set('jalons', meta.jalons.filter((x) => x.id !== j.id))}>✕</button>
                )}
              </div>
            ))}
            <datalist id="cdc-jalon-labels">
              {lists.jalonLabels.map((l) => <option key={l} value={l} />)}
            </datalist>
            {editable && (
              <button className="btn btn-sm btn-ghost" onClick={() => set('jalons', [...meta.jalons, { id: newJalonId(), label: '', date: '' }])}>
                + Ajouter un jalon
              </button>
            )}
            {!meta.jalons.length && !editable && <span className="muted">—</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
