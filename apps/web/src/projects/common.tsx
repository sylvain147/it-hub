import { createContext, Fragment, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  docToMarkdown,
  HEALTH_ICONS,
  HEALTH_LABELS,
  markdownToDoc,
  PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  type Health,
  type JobInfo,
  type Priority,
  type ProjectDetail,
  type ProjectItemKind,
  type ProjectStatus,
  type RichDoc,
  type RichNode,
} from '@samm/shared';
import { api } from '../api';
import { RichEditor } from '../editor/RichEditor';
import { ErrorBox, Modal, Spinner, shortUser, toast } from '../components/ui';

// ---------------------------------------------------------------------------
// Contexte de la page projet
// ---------------------------------------------------------------------------

export interface ProjectCtx {
  project: ProjectDetail;
  setProject: (p: ProjectDetail) => void;
  reload: () => Promise<void>;
  /** Tâche IA en cours sur le projet. */
  jobBusy: boolean;
  onJob: (j: JobInfo) => void;
  goTab: (tab: string) => void;
}
const Ctx = createContext<ProjectCtx | null>(null);
export const ProjectProvider = Ctx.Provider;
export function useProject(): ProjectCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useProject hors de la page projet');
  return c;
}

/** Création / modification / suppression d'un élément du projet, puis rechargement. */
export function useItemActions() {
  const { project, reload } = useProject();
  return {
    async save(kind: ProjectItemKind, itemId: string | null, data: Record<string, unknown>) {
      if (itemId) await api.updateItem(project.id, kind, itemId, data);
      else await api.createItem(project.id, kind, data);
      await reload();
    },
    async remove(kind: ProjectItemKind, itemId: string, label: string): Promise<boolean> {
      if (!confirm(`Supprimer « ${label} » ?`)) return false;
      try {
        await api.deleteItem(project.id, kind, itemId);
        await reload();
        toast('Supprimé.');
        return true;
      } catch (e) {
        toast((e as Error).message, 'error');
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Badges et formats
// ---------------------------------------------------------------------------

export function HealthBadge({ health, withLabel = true }: { health: Health; withLabel?: boolean }) {
  return (
    <span className={`badge health-${health}`} title={HEALTH_LABELS[health]}>
      {HEALTH_ICONS[health]}
      {withLabel && ` ${HEALTH_LABELS[health]}`}
    </span>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`badge pstatus-${status}`}>{PROJECT_STATUS_LABELS[status]}</span>;
}

export function PriorityTag({ priority, hideNormal }: { priority: Priority; hideNormal?: boolean }) {
  if (hideNormal && priority === 'normale') return null;
  return <span className={`badge ppriority-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}

export const euros = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const days = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('fr-FR')} j/h`);

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/** Une tâche est « à moi » si son responsable correspond à mon adresse ou à mon identifiant. */
export function isMine(assignee: string, email: string): boolean {
  const a = assignee.trim().toLowerCase();
  if (!a) return false;
  const me = email.toLowerCase();
  const short = shortUser(me);
  return a === me || a === short || a.split(/[\s,;/]+/).includes(short) || (short.includes('.') && a.includes(short.replace('.', ' ')));
}

/** Nombre de jours avant une date (négatif si dépassée). */
export function daysUntil(date: string): number {
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  return Math.round((Date.parse(date) - today) / 86400000);
}

export function DueLabel({ date, done }: { date: string; done?: boolean }) {
  if (!date) return <span className="muted">—</span>;
  const n = daysUntil(date);
  const label = new Date(date + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: n > 300 || n < -300 ? 'numeric' : undefined });
  if (done) return <span className="muted">{label}</span>;
  const cls = n < 0 ? 'due-late' : n <= 7 ? 'due-soon' : '';
  const hint = n < 0 ? `en retard de ${-n} j` : n === 0 ? 'aujourd’hui' : n === 1 ? 'demain' : n <= 7 ? `dans ${n} j` : '';
  return (
    <span className={cls} title={hint}>
      {label}
      {hint && n <= 7 && <span className="small"> · {hint}</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Markdown : affichage léger et saisie riche
// ---------------------------------------------------------------------------

/** Affiche du Markdown sans charger d'éditeur (journal, fiche en lecture). */
export function MarkdownView({ markdown, className }: { markdown: string; className?: string }) {
  const doc = useMemo(() => markdownToDoc(markdown), [markdown]);
  if (!markdown.trim()) return null;
  return <div className={`md ${className ?? ''}`}>{renderNodes(doc.content)}</div>;
}

function renderNodes(nodes: RichNode[] | undefined): ReactNode {
  return (nodes ?? []).map((n, i) => <Fragment key={i}>{renderNode(n)}</Fragment>);
}

function renderNode(n: RichNode): ReactNode {
  const c = renderNodes(n.content);
  switch (n.type) {
    case 'paragraph':
      return <p>{c}</p>;
    case 'heading':
      return Number(n.attrs?.level) <= 2 ? <h4>{c}</h4> : <h5>{c}</h5>;
    case 'bulletList':
      return <ul>{c}</ul>;
    case 'orderedList':
      return <ol start={Number(n.attrs?.start ?? 1)}>{c}</ol>;
    case 'listItem':
      return <li>{c}</li>;
    case 'blockquote':
      return <blockquote>{c}</blockquote>;
    case 'codeBlock':
      return <pre>{c}</pre>;
    case 'horizontalRule':
      return <hr />;
    case 'hardBreak':
      return <br />;
    case 'table':
      return (
        <table>
          <tbody>{c}</tbody>
        </table>
      );
    case 'tableRow':
      return <tr>{c}</tr>;
    case 'tableHeader':
      return <th>{c}</th>;
    case 'tableCell':
      return <td>{c}</td>;
    case 'text': {
      let el: ReactNode = n.text;
      for (const m of n.marks ?? []) {
        if (m.type === 'bold') el = <strong>{el}</strong>;
        else if (m.type === 'italic') el = <em>{el}</em>;
        else if (m.type === 'strike') el = <s>{el}</s>;
        else if (m.type === 'code') el = <code>{el}</code>;
        else if (m.type === 'link') {
          const href = String(m.attrs?.href ?? '');
          el = /^(https?:|mailto:)/i.test(href) ? <a href={href} target="_blank" rel="noreferrer">{el}</a> : el;
        }
      }
      return el;
    }
    default:
      return c;
  }
}

/** Champ de texte riche dont la valeur est du Markdown. `resetKey` réinitialise l'éditeur. */
export function MarkdownField({ value, onChange, editable = true, placeholder, resetKey }: { value: string; onChange: (md: string) => void; editable?: boolean; placeholder?: string; resetKey?: unknown }) {
  const initial = useMemo<RichDoc>(() => markdownToDoc(value), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <RichEditor
      key={String(resetKey ?? '')}
      value={initial}
      onChange={(doc) => onChange(docToMarkdown(doc))}
      editable={editable}
      placeholder={placeholder}
      compact
    />
  );
}

// ---------------------------------------------------------------------------
// Formulaire d'élément dans une modale
// ---------------------------------------------------------------------------

export function ItemModal({
  title,
  onClose,
  onSave,
  children,
  canSave = true,
  wide,
  extraFooter,
}: {
  title: string;
  onClose: () => void;
  onSave: () => Promise<void>;
  children: ReactNode;
  canSave?: boolean;
  wide?: boolean;
  extraFooter?: ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave();
      onClose();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={wide}
      footer={
        <>
          {extraFooter}
          <span className="tb-flex" />
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!canSave || saving} onClick={save}>
            {saving && <Spinner small />} Enregistrer
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div
        className="form-grid"
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canSave && !saving) void save();
        }}
      >
        {children}
      </div>
    </Modal>
  );
}

/** Suggestions de saisie partagées (responsables, prestataires…). */
export function DataList({ id, values }: { id: string; values: string[] }) {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  return (
    <datalist id={id}>
      {unique.map((v) => (
        <option key={v} value={v} />
      ))}
    </datalist>
  );
}

/** Personnes connues du projet : intervenants, chef de projet, responsables déjà saisis. */
export function knownPeople(p: ProjectDetail, me: string): string[] {
  return [
    shortUser(me),
    p.chefDeProjet,
    ...p.items.contacts.map((c) => c.name),
    ...p.items.tasks.map((t) => t.assignee),
    ...p.items.risks.map((r) => r.owner),
  ];
}
