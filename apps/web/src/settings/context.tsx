/**
 * Paramétrage chargé une fois pour toute l'application (libellés des statuts, prestataires, suggestions).
 * Les pages lisent les libellés ici plutôt que dans les constantes du domaine.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { activePrestataires, normalizeListSettings, statusLabel, statusOptions, type ListSettings, type Prestataire, type StatusListKey, type StatusSetting } from '@samm/shared';
import { api } from '../api';

interface SettingsCtx {
  lists: ListSettings;
  prestataires: Prestataire[];
  /** Prestataires proposés à la saisie (non archivés), par ordre alphabétique. */
  active: Prestataire[];
  label: (list: StatusListKey, key: string) => string;
  options: (list: StatusListKey, current?: string) => StatusSetting[];
  reload: () => Promise<void>;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [lists, setLists] = useState<ListSettings>(() => normalizeListSettings(null));
  const [prestataires, setPrestataires] = useState<Prestataire[]>([]);
  const reload = useCallback(async () => {
    try {
      const s = await api.settings();
      setLists(s.lists);
      setPrestataires(s.prestataires);
    } catch {
      /* hors ligne : on garde les libellés par défaut */
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const value = useMemo<SettingsCtx>(
    () => ({
      lists,
      prestataires,
      active: activePrestataires(prestataires),
      label: (list, key) => statusLabel(lists, list, key),
      options: (list, current) => statusOptions(lists, list, current),
      reload,
    }),
    [lists, prestataires, reload],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSettings hors du SettingsProvider');
  return c;
}

/** Options d'une liste déroulante de statuts. */
export function StatusOptions({ list, current }: { list: StatusListKey; current?: string }) {
  const { options } = useSettings();
  return (
    <>
      {options(list, current).map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </>
  );
}
