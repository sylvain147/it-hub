import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HubUser } from '@samm/shared';
import { api } from '../api';

interface UsersCtx {
  users: HubUser[];
  /** Utilisateurs actifs (proposés comme responsables). */
  active: HubUser[];
  name: (email: string) => string;
  reload: () => Promise<void>;
}

const Ctx = createContext<UsersCtx>({ users: [], active: [], name: (e) => e, reload: async () => {} });
export const useUsers = () => useContext(Ctx);

/** Annuaire des utilisateurs du hub, chargé une fois pour toute l'application. */
export function UsersProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<HubUser[]>([]);
  const reload = useCallback(async () => {
    try {
      setUsers(await api.users());
    } catch {
      /* l'écran qui en a besoin affichera l'erreur */
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const value = useMemo<UsersCtx>(() => {
    const byEmail = new Map(users.map((u) => [u.email, u]));
    return { users, active: users.filter((u) => u.active), name: (e) => byEmail.get(e)?.name ?? e, reload };
  }, [users, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Liste déroulante des utilisateurs (responsable d'une tâche). */
export function UserSelect({
  value,
  onChange,
  allowEmpty,
  emptyLabel = '—',
  only,
  className = 'input',
  id,
}: {
  value: string;
  onChange: (email: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** Restreint la liste (ex. soi-même seulement). */
  only?: string[];
  className?: string;
  id?: string;
}) {
  const { users, active } = useUsers();
  const shown = active.filter((u) => !only || only.includes(u.email));
  const current = users.find((u) => u.email === value);
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {(allowEmpty || !value) && <option value="">{emptyLabel}</option>}
      {current && !shown.includes(current) && <option value={current.email}>{current.name}{current.active ? '' : ' (désactivé)'}</option>}
      {shown.map((u) => (
        <option key={u.email} value={u.email}>{u.name}</option>
      ))}
    </select>
  );
}
