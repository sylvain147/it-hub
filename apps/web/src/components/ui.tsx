import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CDC_STATUS_LABELS, QUESTION_PRIORITIES, type CdcStatus, type QuestionPriority } from '@samm/shared';

export function Spinner({ small }: { small?: boolean }) {
  return <span className={small ? 'spinner spinner-sm' : 'spinner'} aria-label="Chargement" />;
}

export function StatusBadge({ status }: { status: CdcStatus }) {
  return <span className={`badge status-${status}`}>{CDC_STATUS_LABELS[status]}</span>;
}

const PRIORITY_LABEL: Record<QuestionPriority, string> = { bloquante: 'Bloquante', importante: 'Importante', optionnelle: 'Optionnelle' };
export function PriorityBadge({ priority }: { priority: QuestionPriority }) {
  return <span className={`badge prio-${QUESTION_PRIORITIES.indexOf(priority)}`}>{PRIORITY_LABEL[priority]}</span>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
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
