import { useState } from 'react';
import type { Prestataire } from '@samm/shared';
import { api } from '../api';
import { Spinner, toast } from '../components/ui';
import { useSettings } from './context';

/**
 * Choix d'un prestataire du paramétrage, avec création à la volée (« + »).
 * `by` : la valeur est l'identifiant du prestataire (prestations) ou son nom (en-tête des cahiers des charges).
 */
export function PrestatairePicker({
  value,
  onChange,
  by = 'id',
  disabled,
  autoFocus,
  emptyLabel = '— Choisir un prestataire —',
}: {
  value: string;
  onChange: (p: Prestataire | null) => void;
  by?: 'id' | 'name';
  disabled?: boolean;
  autoFocus?: boolean;
  emptyLabel?: string;
}) {
  const { prestataires, active, reload } = useSettings();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const key = (p: Prestataire) => (by === 'id' ? p.id : p.name);
  const current = prestataires.find((p) => key(p) === value);
  // Valeur hors liste : prestataire archivé, ou nom saisi avant le paramétrage.
  const extra = value && !active.some((p) => key(p) === value) ? (current ? `${current.name} (archivé)` : `${value} (hors paramétrage)`) : null;

  async function create() {
    setBusy(true);
    try {
      const p = await api.createPrestataire({ name: name.trim() });
      await reload();
      onChange(p);
      setCreating(false);
      setName('');
      toast(`Prestataire « ${p.name} » ajouté au paramétrage.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      <div className="picker-row">
        <select
          className="input"
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange(prestataires.find((p) => key(p) === e.target.value) ?? null)}
        >
          <option value="">{emptyLabel}</option>
          {extra && <option value={value}>{extra}</option>}
          {active.map((p) => (
            <option key={p.id} value={key(p)}>{p.name}</option>
          ))}
        </select>
        {!disabled && (
          <button type="button" className="btn" title="Nouveau prestataire" onClick={() => setCreating((v) => !v)}>
            +
          </button>
        )}
      </div>
      {creating && (
        <div className="picker-row">
          <input
            className="input"
            autoFocus
            placeholder="Nom du nouveau prestataire"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) {
                e.preventDefault();
                void create();
              }
            }}
          />
          <button type="button" className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void create()}>
            {busy ? <Spinner small /> : 'Créer'}
          </button>
        </div>
      )}
    </div>
  );
}
