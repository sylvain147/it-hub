import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { parisDay, type PersonalTask } from '@samm/shared';
import { api, TODOS_CHANGED } from '../api';
import { useAuth } from '../auth';

/** Rafraîchissement de la pastille (en plus de chaque changement de page). */
const REFRESH_MS = 60_000;

/** Tâches à faire aujourd'hui ou en retard : échéance passée ou du jour, pas encore cochées. */
export function isDueOrLate(t: Pick<PersonalTask, 'done' | 'dueDate'>, today: string): boolean {
  return !t.done && !!t.dueDate && t.dueDate <= today;
}

/** Pastille de l'entrée « To-do » du menu : nombre de mes tâches du jour ou en retard. */
export function TodoBadge() {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const [due, setDue] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await api.todos();
      const today = parisDay(Date.now());
      setDue(r.personal.filter((t) => t.assigneeId === me.email && isDueOrLate(t, today)).length);
    } catch {
      /* la pastille attendra le prochain essai */
    }
  }, [me.email]);

  useEffect(() => {
    void load();
  }, [load, pathname]);
  useEffect(() => {
    const t = setInterval(() => void load(), REFRESH_MS);
    const on = () => void load();
    window.addEventListener(TODOS_CHANGED, on);
    window.addEventListener('focus', on);
    return () => {
      clearInterval(t);
      window.removeEventListener(TODOS_CHANGED, on);
      window.removeEventListener('focus', on);
    };
  }, [load]);

  if (!due) return null;
  return (
    <span className="nav-badge" title={`${due} tâche${due > 1 ? 's' : ''} pour aujourd’hui ou en retard`}>
      {due}
    </span>
  );
}
