import { useState } from 'react';
import { Link } from 'react-router';
import { ENGAGED_PRESTA_STATUSES, PRESTA_STATUSES, PRESTA_STATUS_LABELS, type Prestation, type PrestaStatus } from '@samm/shared';
import { api } from '../api';
import { EmptyState, toast } from '../components/ui';
import { DataList, DueLabel, ItemModal, days, euros, useItemActions, useProject } from './common';

export function PrestationsTab() {
  const { project, reload, goTab } = useProject();
  const actions = useItemActions();
  const [editing, setEditing] = useState<Prestation | 'new' | null>(null);
  const list = project.items.prestations;
  const s = project.stats;

  async function setStatus(p: Prestation, status: PrestaStatus) {
    try {
      await api.updateItem(project.id, 'prestations', p.id, { status });
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div>
      <div className="toolbar-row">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Ajouter une prestation</button>
        <span className="muted small">Une prestation = un devis ou une commande auprès d’un prestataire. Elle peut donner lieu à un cahier des charges.</span>
      </div>
      {list.length > 0 && (
        <div className="kpis">
          <div className="kpi"><span className="kpi-value">{euros(s.montantPrevu)}</span><span className="kpi-label">prévus (hors annulés)</span></div>
          <div className="kpi"><span className="kpi-value">{euros(s.montantEngage)}</span><span className="kpi-label">engagés (commandés et au-delà)</span></div>
          <div className="kpi"><span className="kpi-value">{days(s.chargeJours)}</span><span className="kpi-label">charge totale</span></div>
          {project.budgetPrevu != null && (
            <div className={`kpi${s.montantPrevu > project.budgetPrevu ? ' kpi-danger' : ''}`}>
              <span className="kpi-value">{euros(project.budgetPrevu - s.montantPrevu)}</span>
              <span className="kpi-label">reste sur le budget de {euros(project.budgetPrevu)}</span>
            </div>
          )}
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState>Aucune prestation. Saisissez les devis et commandes des prestataires pour suivre la charge et le budget.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Prestataire</th>
                <th>Objet</th>
                <th>Statut</th>
                <th className="num">Charge</th>
                <th className="num">Montant HT</th>
                <th>Devis / commande</th>
                <th>Livraison</th>
                <th>CDC</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const cdc = project.cdcs.find((c) => c.id === p.cdcId);
                return (
                  <tr key={p.id} className={p.status === 'annule' ? 'row-done' : ''}>
                    <td className="strong">{p.prestataire}</td>
                    <td>
                      <button className="btn-link strong-link" onClick={() => setEditing(p)}>{p.objet}</button>
                      {p.notes && <div className="muted small clamp">{p.notes}</div>}
                    </td>
                    <td>
                      <select className={`input input-sm presta-${ENGAGED_PRESTA_STATUSES.includes(p.status) ? 'engaged' : p.status}`} value={p.status} onChange={(e) => void setStatus(p, e.target.value as PrestaStatus)}>
                        {PRESTA_STATUSES.map((st) => <option key={st} value={st}>{PRESTA_STATUS_LABELS[st]}</option>)}
                      </select>
                    </td>
                    <td className="num">{days(p.chargeJours)}</td>
                    <td className="num">{euros(p.montantHT)}</td>
                    <td className="small">
                      {p.referenceDevis && <div>Devis {p.referenceDevis}</div>}
                      {p.bonCommande && <div>BC {p.bonCommande}</div>}
                      {!p.referenceDevis && !p.bonCommande && <span className="muted">—</span>}
                    </td>
                    <td>{p.dateLivraison ? <DueLabel date={p.dateLivraison} done={['livre', 'facture', 'annule'].includes(p.status)} /> : <span className="muted">—</span>}</td>
                    <td>
                      {cdc ? (
                        <Link to={`/cdc/${cdc.id}`} className="small">📄 v{cdc.currentVersion.label}</Link>
                      ) : (
                        <button className="btn-link small" onClick={() => goTab('cdc')}>Rédiger</button>
                      )}
                    </td>
                    <td className="num"><button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('prestations', p.id, `${p.prestataire} — ${p.objet}`)}>🗑</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <PrestationDialog presta={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PrestationDialog({ presta, onClose }: { presta: Prestation | null; onClose: () => void }) {
  const { project } = useProject();
  const actions = useItemActions();
  const [f, setF] = useState({
    prestataire: presta?.prestataire ?? project.stats.prestataires[0] ?? '',
    objet: presta?.objet ?? '',
    status: presta?.status ?? ('a_chiffrer' as PrestaStatus),
    chargeJours: presta?.chargeJours ?? null,
    montantHT: presta?.montantHT ?? null,
    referenceDevis: presta?.referenceDevis ?? '',
    bonCommande: presta?.bonCommande ?? '',
    dateLivraison: presta?.dateLivraison ?? '',
    cdcId: presta?.cdcId ?? null,
    notes: presta?.notes ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === '' ? null : Number(v.replace(',', '.')));
  return (
    <ItemModal title={presta ? 'Prestation' : 'Nouvelle prestation'} onClose={onClose} canSave={!!f.prestataire.trim() && !!f.objet.trim()} onSave={() => actions.save('prestations', presta?.id ?? null, f)}>
      <label className="field">
        <span>Prestataire *</span>
        <input className="input" autoFocus list="prestataires" value={f.prestataire} onChange={(e) => set('prestataire', e.target.value)} />
        <DataList id="prestataires" values={[...project.stats.prestataires, ...project.items.contacts.map((c) => c.organisation)]} />
      </label>
      <label className="field">
        <span>Statut</span>
        <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as PrestaStatus)}>
          {PRESTA_STATUSES.map((st) => <option key={st} value={st}>{PRESTA_STATUS_LABELS[st]}</option>)}
        </select>
      </label>
      <label className="field span-2">
        <span>Objet *</span>
        <input className="input" value={f.objet} onChange={(e) => set('objet', e.target.value)} placeholder="ex. Développement de l’offre Essentiel" />
      </label>
      <label className="field">
        <span>Charge (jours/homme)</span>
        <input className="input" inputMode="decimal" value={f.chargeJours ?? ''} onChange={(e) => set('chargeJours', num(e.target.value))} />
      </label>
      <label className="field">
        <span>Montant (€ HT)</span>
        <input className="input" inputMode="decimal" value={f.montantHT ?? ''} onChange={(e) => set('montantHT', num(e.target.value))} />
      </label>
      <label className="field">
        <span>Référence du devis</span>
        <input className="input" value={f.referenceDevis} onChange={(e) => set('referenceDevis', e.target.value)} />
      </label>
      <label className="field">
        <span>Bon de commande</span>
        <input className="input" value={f.bonCommande} onChange={(e) => set('bonCommande', e.target.value)} />
      </label>
      <label className="field">
        <span>Livraison prévue</span>
        <input className="input" type="date" value={f.dateLivraison} onChange={(e) => set('dateLivraison', e.target.value)} />
      </label>
      <label className="field">
        <span>Cahier des charges</span>
        <select className="input" value={f.cdcId ?? ''} onChange={(e) => set('cdcId', e.target.value || null)}>
          <option value="">—</option>
          {project.cdcs.map((c) => <option key={c.id} value={c.id}>{c.title} (v{c.currentVersion.label})</option>)}
        </select>
      </label>
      <label className="field span-2">
        <span>Notes</span>
        <textarea className="input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Conditions, garantie, contacts…" />
      </label>
    </ItemModal>
  );
}
