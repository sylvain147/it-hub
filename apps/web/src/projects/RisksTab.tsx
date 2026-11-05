import { useState } from 'react';
import { useAuth } from '../auth';
import { RISK_LEVELS, RISK_LEVEL_LABELS, riskScore, type Risk, type RiskLevel, type RiskStatus } from '@samm/shared';
import { StatusOptions } from '../settings/context';
import { api } from '../api';
import { EmptyState, toast } from '../components/ui';
import { DataList, ItemModal, knownPeople, useItemActions, useProject } from './common';

function scoreClass(n: number) {
  return n >= 6 ? 'risk-high' : n >= 3 ? 'risk-mid' : 'risk-low';
}

export function RisksTab() {
  const { project, reload } = useProject();
  const actions = useItemActions();
  const [editing, setEditing] = useState<Risk | 'new' | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const all = [...project.items.risks].sort((a, b) => riskScore(b) - riskScore(a));
  const open = all.filter((r) => r.status !== 'clos');
  const list = showClosed ? all : open;

  async function setStatus(r: Risk, status: RiskStatus) {
    try {
      await api.updateItem(project.id, 'risks', r.id, { status });
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div>
      <div className="toolbar-row">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Ajouter un risque</button>
        <span className="tb-flex" />
        {all.length > open.length && (
          <label className="check"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Afficher les risques clos ({all.length - open.length})</label>
        )}
      </div>
      {all.length === 0 ? (
        <EmptyState>Aucun risque identifié. Retard d’un prestataire, dépendance à un autre projet, disponibilité des utilisateurs pour la recette… mieux vaut les noter tôt.</EmptyState>
      ) : (
        <div className="risks-layout">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Risque</th>
                  <th className="num">Criticité</th>
                  <th>Parade</th>
                  <th>Responsable</th>
                  <th>Statut</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} className={r.status === 'clos' ? 'row-done' : ''}>
                    <td>
                      <button className="btn-link strong-link" onClick={() => setEditing(r)}>{r.title}</button>
                      {r.description && <div className="muted small clamp">{r.description}</div>}
                    </td>
                    <td className="num">
                      <span className={`badge ${scoreClass(riskScore(r))}`} title={`Probabilité ${RISK_LEVEL_LABELS[r.probability]} × impact ${RISK_LEVEL_LABELS[r.impact]}`}>{riskScore(r)}/9</span>
                    </td>
                    <td className="small">{r.mitigation || <span className="muted">—</span>}</td>
                    <td>{r.owner || <span className="muted">—</span>}</td>
                    <td>
                      <select className="input input-sm" value={r.status} onChange={(e) => void setStatus(r, e.target.value as RiskStatus)}>
                        <StatusOptions list="risk" current={r.status} />
                      </select>
                    </td>
                    <td className="num"><button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('risks', r.id, r.title)}>🗑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RiskMatrix risks={open} onPick={setEditing} />
        </div>
      )}
      {editing && <RiskDialog risk={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

/** Matrice probabilité × impact des risques ouverts. */
function RiskMatrix({ risks, onPick }: { risks: Risk[]; onPick: (r: Risk) => void }) {
  const levels = [...RISK_LEVELS].reverse();
  return (
    <div className="card risk-matrix">
      <h3 className="no-margin">Matrice des risques ouverts</h3>
      <div className="matrix">
        <div className="matrix-ylabel">Probabilité</div>
        {levels.map((p) => (
          <div key={p} className="matrix-row">
            <span className="matrix-axis">{RISK_LEVEL_LABELS[p]}</span>
            {RISK_LEVELS.map((i) => {
              const cell = risks.filter((r) => r.probability === p && r.impact === i);
              const score = (RISK_LEVELS.indexOf(p) + 1) * (RISK_LEVELS.indexOf(i) + 1);
              return (
                <div key={i} className={`matrix-cell ${scoreClass(score)}`}>
                  {cell.map((r) => (
                    <button key={r.id} className="matrix-dot" title={r.title} onClick={() => onPick(r)}>
                      {r.title.slice(0, 18)}{r.title.length > 18 ? '…' : ''}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
        <div className="matrix-row">
          <span className="matrix-axis" />
          {RISK_LEVELS.map((i) => <span key={i} className="matrix-axis matrix-x">{RISK_LEVEL_LABELS[i]}</span>)}
        </div>
        <div className="matrix-xlabel">Impact</div>
      </div>
    </div>
  );
}

function RiskDialog({ risk, onClose }: { risk: Risk | null; onClose: () => void }) {
  const { project } = useProject();
  const { email } = useAuth();
  const actions = useItemActions();
  const [f, setF] = useState({
    title: risk?.title ?? '',
    description: risk?.description ?? '',
    probability: risk?.probability ?? ('moyen' as RiskLevel),
    impact: risk?.impact ?? ('moyen' as RiskLevel),
    mitigation: risk?.mitigation ?? '',
    owner: risk?.owner ?? '',
    status: risk?.status ?? ('ouvert' as RiskStatus),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const score = riskScore(f);
  return (
    <ItemModal title={risk ? 'Risque' : 'Nouveau risque'} onClose={onClose} canSave={!!f.title.trim()} onSave={() => actions.save('risks', risk?.id ?? null, f)}>
      <label className="field span-2">
        <span>Intitulé *</span>
        <input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="ex. Indisponibilité des utilisateurs clés pendant la recette" />
      </label>
      <label className="field">
        <span>Probabilité</span>
        <select className="input" value={f.probability} onChange={(e) => set('probability', e.target.value as RiskLevel)}>
          {RISK_LEVELS.map((l) => <option key={l} value={l}>{RISK_LEVEL_LABELS[l]}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Impact <span className={`badge ${scoreClass(score)}`}>criticité {score}/9</span></span>
        <select className="input" value={f.impact} onChange={(e) => set('impact', e.target.value as RiskLevel)}>
          {RISK_LEVELS.map((l) => <option key={l} value={l}>{RISK_LEVEL_LABELS[l]}</option>)}
        </select>
      </label>
      <label className="field span-2">
        <span>Description</span>
        <textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
      </label>
      <label className="field span-2">
        <span>Parade / plan d’action</span>
        <textarea className="input" rows={2} value={f.mitigation} onChange={(e) => set('mitigation', e.target.value)} />
      </label>
      <label className="field">
        <span>Responsable</span>
        <input className="input" list="people-r" value={f.owner} onChange={(e) => set('owner', e.target.value)} />
        <DataList id="people-r" values={knownPeople(project, email)} />
      </label>
      <label className="field">
        <span>Statut</span>
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as RiskStatus)}>
          <StatusOptions list="risk" current={f.status} />
        </select>
      </label>
    </ItemModal>
  );
}
