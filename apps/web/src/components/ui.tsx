import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { QUESTION_PRIORITIES, type CdcStatus, type QuestionPriority } from '@samm/shared';
import { useSettings } from '../settings/context';

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-label="Chargement" />;
}

export function StatusBadge({ status }: { status: CdcStatus }) {
  const { label } = useSettings();
  return <span className={`badge status-${status}`}>{label('cdc', status)}</span>;
}

const PRIORITY_LABEL: Record<QuestionPriority, string> = { bloquante: 'Bloquante', importante: 'Importante', optionnelle: 'Optionnelle' };
export function PriorityBadge({ priority }: { priority: QuestionPriority }) {
  return <span className={`badge prio-${QUESTION_PRIORITIES.indexOf(priority)}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Fenêtres superposées (ex. nouveau projet depuis une tâche) : Échap ne ferme que celle du dessus.
      const all = document.querySelectorAll('.modal-backdrop');
      if (e.key === 'Escape' && all[all.length - 1] === ref.current?.parentElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal modal-wide' : 'modal'} ref={ref} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="alert alert-error">{error instanceof Error ? error.message : String(error)}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string) {
  if (!iso) return '';
  return new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortUser(email: string) {
  return email.split('@')[0] ?? email;
}

/** Notifications éphémères. */
type ToastKind = 'ok' | 'error' | 'info';
let pushToast: ((msg: string, kind: ToastKind) => void) | null = null;
export function toast(msg: string, kind: ToastKind = 'ok') {
  pushToast?.(msg, kind);
}
export function ToastHost() {
  const [items, setItems] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  useEffect(() => {
    pushToast = (msg, kind) => {
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs, { id, msg, kind }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 4000);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

export interface MultiSelectOption {
  value: string;
  label: string;
  /** Précision affichée en gris (ex. « désactivé »). */
  hint?: string;
  /** Retirable mais plus proposé. */
  disabled?: boolean;
}

/**
 * Liste déroulante à choix multiples : les choix forment des étiquettes retirables, la saisie filtre la liste.
 * Clavier : ↑ ↓ pour parcourir, Entrée pour choisir, Retour arrière pour retirer le dernier choix, Échap pour fermer.
 */
export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = 'Choisir…',
  empty = 'Aucun résultat',
}: {
  value: string[];
  onChange: (values: string[]) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const byValue = new Map(options.map((o) => [o.value, o]));
  const q = normalize(query);
  const shown = options.filter((o) => !value.includes(o.value) && !o.disabled && normalize(o.label).includes(q));

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => setActive(0), [query, open]);

  const add = (v: string) => {
    onChange([...value, v]);
    setQuery('');
    input.current?.focus();
  };
  const remove = (v: string) => onChange(value.filter((x) => x !== v));

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // Pas d'envoi du formulaire ni de fermeture de la modale.
      e.preventDefault();
      if (open && shown[active]) add(shown[active].value);
      else setOpen(true);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'Backspace' && !query && value.length) {
      remove(value[value.length - 1]!);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={box} className={`multi-select${open ? ' open' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), input.current?.focus(), setOpen(true))}>
      {value.map((v) => {
        const o = byValue.get(v);
        return (
          <span key={v} className="ms-tag">
            {o?.label ?? v}
            {o?.hint && <span className="ms-hint">({o.hint})</span>}
            <button type="button" className="ms-remove" title="Retirer" aria-label={`Retirer ${o?.label ?? v}`} onClick={() => remove(v)}>×</button>
          </span>
        );
      })}
      <input
        ref={input}
        className="ms-input"
        value={query}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        role="combobox"
        aria-expanded={open}
      />
      <span className="ms-caret" aria-hidden onMouseDown={(e) => (e.preventDefault(), input.current?.focus(), setOpen((x) => !x))}>▾</span>
      {open && (
        <ul className="ms-menu" role="listbox">
          {shown.length ? (
            shown.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => (e.preventDefault(), add(o.value))}
              >
                {o.label}
                {o.hint && <span className="ms-hint">({o.hint})</span>}
              </li>
            ))
          ) : (
            <li className="ms-empty">{options.length && options.every((o) => value.includes(o.value) || o.disabled) ? 'Tout est déjà choisi' : empty}</li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Pour filtrer sans tenir compte des majuscules ni des accents. */
function normalize(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
