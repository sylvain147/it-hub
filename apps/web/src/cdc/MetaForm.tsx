import {
  CDC_STATUSES,
  CDC_STATUS_LABELS,
  MAJOR_VERSION_STATUSES,
  PROJECT_PHASES,
  PROJECT_PHASE_LABELS,
  type CdcMeta,
  type CdcStatus,
  type Jalon,
  type ProjectPhase,
} from '@samm/shared';

const newJalonId = () => Math.random().toString(36).slice(2, 10);

export function MetaForm({ meta, onChange, editable }: { meta: CdcMeta; onChange: (m: CdcMeta) => void; editable: boolean }) {
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
            {CDC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CDC_STATUS_LABELS[s]}
                {MAJOR_VERSION_STATUSES.includes(s) ? ' (version majeure)' : ''}
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
        <label className="field">
          <span>Prestataire</span>
          <input className="input" value={meta.prestataire} disabled={!editable} onChange={(e) => set('prestataire', e.target.value)} />
        </label>
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
                <input className="input" placeholder="Jalon (ex. Testing phase 1, Production)" value={j.label} disabled={!editable} onChange={(e) => setJalon(j.id, { label: e.target.value })} />
                <input className="input input-date" type="date" value={j.date} disabled={!editable} onChange={(e) => setJalon(j.id, { date: e.target.value })} />
                {editable && (
                  <button className="btn-icon" title="Retirer ce jalon" onClick={() => set('jalons', meta.jalons.filter((x) => x.id !== j.id))}>✕</button>
                )}
              </div>
            ))}
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
