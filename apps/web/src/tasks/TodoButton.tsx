import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { parisDay, type PersonalTask } from '@samm/shared';
import { api, TODOS_CHANGED } from '../api';
import { useAuth } from '../auth';
import { toast } from '../components/ui';
import { DueLabel } from '../projects/common';

/** Rafraîchissement de la pastille (en plus de chaque changement de page). */
const REFRESH_MS = 60_000;

/** Tâches à faire aujourd'hui ou en retard : échéance passée ou du jour, pas encore cochées. */
export function isDueOrLate(t: Pick<PersonalTask, 'done' | 'dueDate'>, today: string): boolean {
  return !t.done && !!t.dueDate && t.dueDate <= today;
}

/**
 * Bouton « To-do » toujours visible en haut à droite : la pastille compte mes tâches du jour ou en retard ;
 * un clic ouvre ma to-do (non cochée), à cocher sur place, avec une saisie rapide.
 */
export function TodoButton() {
  const { me } = useAuth();
  const location = useLocation();
  const [todos, setTodos] = useState<PersonalTask[] | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const today = parisDay(Date.now());

  const load = useCallback(async () => {
    try {
      const r = await api.todos();
      setTodos(r.personal.filter((t) => t.assigneeId === me.email));
    } catch {
      /* la pastille attendra le prochain essai */
    }
  }, [me.email]);

  useEffect(() => {
    void load();
  }, [load, location.pathname]);
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
  useEffect(() => setOpen(false), [location.pathname]);

  const due = (todos ?? []).filter((t) => isDueOrLate(t, today));
  const pending = (todos ?? [])
    .filter((t) => !t.done)
    .sort((a, b) => Number(isDueOrLate(b, today)) - Number(isDueOrLate(a, today)) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

  async function check(t: PersonalTask) {
    try {
      await api.updateTodo(t.id, { done: true });
      toast(`« ${t.title} » cochée.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function add() {
    if (!title.trim()) return;
    try {
      await api.createTodo({ title: title.trim(), assigneeId: me.email });
      setTitle('');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      <button
        className={open ? 'todo-fab open' : 'todo-fab'}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={due.length ? `${due.length} tâche${due.length > 1 ? 's' : ''} pour aujourd’hui ou en retard` : 'Ma to-do'}
      >
        ✅ <span className="todo-fab-label">To-do</span>
        {due.length > 0 && <span className="todo-fab-badge">{due.length}</span>}
      </button>
      {open && (
        <>
          <div className="todo-pop-backdrop" onClick={() => setOpen(false)} />
          <div className="todo-pop" role="dialog" aria-label="Ma to-do">
            <div className="todo-pop-head">
              <strong>Ma to-do</strong>
              <Link to="/todo" className="small">Tout voir →</Link>
            </div>
            <div className="todo-pop-add">
              <input className="input input-sm" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="Nouvelle tâche, puis Entrée" autoFocus />
            </div>
            {!todos ? (
              <p className="muted small">Chargement…</p>
            ) : !pending.length ? (
              <p className="muted small">Rien à faire. 🎉</p>
            ) : (
              <ul className="todo-pop-list">
                {pending.slice(0, 30).map((t) => (
                  <li key={t.id} className={isDueOrLate(t, today) ? 'due' : undefined}>
                    <input type="checkbox" checked={false} onChange={() => void check(t)} aria-label={`Cocher « ${t.title} »`} />
                    <Link to={t.projectId ? `/projets/${t.projectId}?onglet=todo&tache=${encodeURIComponent(t.id)}` : `/todo?tache=${encodeURIComponent(t.id)}`}>{t.title}</Link>
                    {t.dueDate && <span className="small"><DueLabel date={t.dueDate} /></span>}
                  </li>
                ))}
                {pending.length > 30 && <li className="muted small">… et {pending.length - 30} autres</li>}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}
