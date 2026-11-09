import { useState } from 'react';
import { isJalonLate, jalonDrift, jalonPeriod, type ProjectJalon } from '@samm/shared';
import { api } from '../api';
import { EmptyState, formatDate, toast } from '../components/ui';
import { DueLabel, ItemModal, useItemActions, useProject } from './common';
import { useSettings } from '../settings/context';

export function PlanningTab() {
  const { project, reload } = useProject();
  const actions = useItemActions();
  const [editing, setEditing] = useState<ProjectJalon | 'new' | null>(null);
  const jalons = project.items.jalons;

  async function toggle(j: ProjectJalon) {
    try {
      await api.updateItem(project.id, 'jalons', j.id, { done: !j.done });
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div>
      <div className="toolbar-row">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Ajouter un jalon</button>
        <span className="muted small">Les jalons sont repris dans le bandeau « Échéance cible » des cahiers des charges générés depuis le projet.</span>
      </div>
      <Timeline />
      {jalons.length === 0 ? (
        <EmptyState>Aucun jalon. Ajoutez les grandes dates : réception du devis, livraison, recette, mise en production…</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th>Jalon</th>
                <th>Date</th>
                <th>Glissement</th>
                <th>État</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jalons.map((j) => {
                const drift = jalonDrift(j);
                return (
                  <tr key={j.id} className={j.done ? 'row-done' : ''}>
                    <td><input type="checkbox" checked={j.done} title="Atteint" onChange={() => void toggle(j)} /></td>
                    <td>
                      <button className="btn-link strong-link" onClick={() => setEditing(j)}>{j.label}</button>
                      {j.notes && <div className="muted small">{j.notes}</div>}
                    </td>
                    <td>
                      {j.date ? <DueLabel date={j.date} done={j.done} /> : <span className="muted">À définir</span>}
                      {j.startDate && <div className="muted small">{jalonPeriod(j, formatDate)}</div>}
                    </td>
                    <td>
                      {drift !== 0 ? (
                        <span className={drift > 0 ? 'due-late' : 'ok-text'} title={`Date initiale : ${formatDate(j.initialDate)}`}>
                          {drift > 0 ? '+' : ''}{drift} j
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {j.done ? <span className="badge badge-ok">Atteint</span> : isJalonLate(j) ? <span className="badge badge-danger">En retard</span> : <span className="badge">À venir</span>}
                    </td>
                    <td className="num">
                      <button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('jalons', j.id, j.label)}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <JalonDialog jalon={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Frise : début du projet, jalons (ponctuels ou sur une période), aujourd'hui, fin visée. */
function Timeline() {
  const { project } = useProject();
  const today = new Date().toISOString().slice(0, 10);
  const jalons = project.items.jalons.filter((j) => j.date);
  const points = [
    ...jalons.map((j) => ({ date: j.date, label: j.label, cls: j.done ? 'tl-done' : isJalonLate(j) ? 'tl-late' : 'tl-todo' })),
    ...jalons.filter((j) => j.startDate).map((j) => ({ date: j.startDate, label: '', cls: 'tl-start-only' })),
    ...(project.startDate ? [{ date: project.startDate, label: 'Début', cls: 'tl-bound' }] : []),
    ...(project.targetDate ? [{ date: project.targetDate, label: 'Fin visée', cls: 'tl-bound' }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (points.length < 2) return null;
  const min = Date.parse(points[0]!.date < today ? points[0]!.date : today);
  const max = Date.parse(points.at(-1)!.date > today ? points.at(-1)!.date : today);
  const span = Math.max(max - min, 86400000);
  const pos = (d: string) => 2 + ((Date.parse(d) - min) / span) * 96;
  return (
    <div className="card timeline-wrap">
      <div className="timeline">
        <div className="tl-axis" />
        <div className="tl-today" style={{ left: `${pos(today)}%` }} title="Aujourd’hui"><span>Aujourd’hui</span></div>
        {jalons.filter((j) => j.startDate).map((j) => (
          <div key={`p${j.id}`} className={`tl-range ${j.done ? 'tl-done' : isJalonLate(j) ? 'tl-late' : 'tl-todo'}`} style={{ left: `${pos(j.startDate)}%`, width: `${pos(j.date) - pos(j.startDate)}%` }} title={`${j.label} — ${jalonPeriod(j, formatDate)}`} />
        ))}
        {points.filter((p) => p.label).map((p, i) => (
          <div key={i} className={`tl-point ${p.cls} ${i % 2 ? 'tl-below' : 'tl-above'}${pos(p.date) < 12 ? ' tl-start' : pos(p.date) > 88 ? ' tl-end' : ''}`} style={{ left: `${pos(p.date)}%` }} title={`${p.label} — ${formatDate(p.date)}`}>
            <span className="tl-dot" />
            <span className="tl-label">
              <strong>{p.label}</strong>
              <br />
              {formatDate(p.date)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function JalonDialog({ jalon, onClose }: { jalon: ProjectJalon | null; onClose: () => void }) {
  const actions = useItemActions();
  const { lists } = useSettings();
  const [f, setF] = useState({ label: jalon?.label ?? '', startDate: jalon?.startDate ?? '', date: jalon?.date ?? '', done: jalon?.done ?? false, notes: jalon?.notes ?? '' });
  const badRange = !!f.startDate && (!f.date || f.startDate > f.date);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <ItemModal title={jalon ? 'Jalon' : 'Nouveau jalon'} onClose={onClose} canSave={!!f.label.trim() && !badRange} onSave={() => actions.save('jalons', jalon?.id ?? null, f)}>
      <label className="field span-2">
        <span>Libellé *</span>
        <input className="input" autoFocus value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="ex. Recette, Mise en production" list="jalon-suggestions" />
        <datalist id="jalon-suggestions">
          {lists.jalonLabels.map((s) => <option key={s} value={s} />)}
        </datalist>
      </label>
      <label className="field">
        <span>Date de début</span>
        <input className="input" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} />
        <span className="muted small">Facultative : pour un jalon qui dure (recette, déploiement…).</span>
      </label>
      <label className="field">
        <span>{f.startDate ? 'Date de fin' : 'Date'}</span>
        <input className="input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        {badRange && <span className="small due-late">{f.date ? 'La fin doit suivre le début.' : 'Renseignez la date de fin.'}</span>}
        {jalon?.initialDate && jalon.initialDate !== f.date && <span className="muted small">Date initiale : {formatDate(jalon.initialDate)}</span>}
      </label>
      <label className="field">
        <span>État</span>
        <label className="check"><input type="checkbox" checked={f.done} onChange={(e) => set('done', e.target.checked)} /> Atteint</label>
      </label>
      <label className="field span-2">
        <span>Notes</span>
        <textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </label>
    </ItemModal>
  );
}
