import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { NOTE_DEFAULT_HEIGHT, NOTE_MAX_HEIGHT, NOTE_MAX_WIDTH, NOTE_MIN_HEIGHT, type PersonalNote } from '@samm/shared';
import { api } from '../api';
import { formatDate, formatDateTime, toast } from '../components/ui';
import { ItemModal, MarkdownField, MarkdownView } from '../projects/common';
import { ProjectSelect, type ProjectRef } from '../tasks/tasks';
import { useAuth } from '../auth';
import { UserSelect, useUsers } from '../users/context';

/**
 * Notes en vrac : le bloc-notes personnel de chacun, rattaché ou non à un projet. Les administrateurs voient
 * celles de tout le monde et peuvent en ajouter à quelqu'un.
 * Les comptes rendus et décisions partagés avec l'équipe vont, eux, dans le journal du projet.
 */

/** Saisie rapide : on écrit, Ctrl/⌘ + Entrée pour enregistrer. */
export function NoteQuickAdd({ projectId = '', ownerId, onAdded }: { projectId?: string; ownerId?: string; onAdded: () => Promise<void> | void }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    if (!v.trim() || busy) return;
    setBusy(true);
    try {
      await api.createNote({ content: v.trim(), projectId, ...(ownerId ? { ownerId } : {}) });
      setV('');
      await onAdded();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="note-quick">
      <textarea
        className="input"
        rows={2}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void add()}
        placeholder="Noter quelque chose… (Ctrl + Entrée)"
      />
      <button className="btn" disabled={!v.trim() || busy} onClick={() => void add()}>Ajouter</button>
    </div>
  );
}

/** Taille d'un post-it : largeur en colonnes, hauteur visible du texte (0 : la note entière). */
interface NoteSize {
  width: number;
  height: number;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Nombre et largeur des colonnes de la grille, suivis au redimensionnement de la fenêtre. */
function useGridColumns(ref: React.RefObject<HTMLElement | null>) {
  const [grid, setGrid] = useState({ cols: 1, colWidth: 260, gap: 12 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const tracks = style.gridTemplateColumns.split(' ').filter(Boolean);
      const next = { cols: Math.max(1, tracks.length), colWidth: parseFloat(tracks[0] ?? '') || 260, gap: parseFloat(style.columnGap) || 0 };
      setGrid((g) => (g.cols === next.cols && Math.abs(g.colWidth - next.colWidth) < 1 && g.gap === next.gap ? g : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return grid;
}

/**
 * Notes en cartes (post-it) : épinglées d'abord. Un clic ouvre la note. La poignée en bas à droite agrandit ou
 * réduit le post-it (largeur en colonnes, hauteur libre) pour lire la note sans l'ouvrir ; double-clic : la note
 * entière, ou la taille par défaut.
 */
export function NoteGrid({
  notes,
  projects,
  showProject = true,
  onOpen,
  onChanged,
}: {
  notes: PersonalNote[];
  projects: ProjectRef[];
  showProject?: boolean;
  onOpen: (n: PersonalNote) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { me } = useAuth();
  const { name } = useUsers();
  const gridRef = useRef<HTMLDivElement>(null);
  const grid = useGridColumns(gridRef);
  // Taille affichée pendant et juste après un redimensionnement, en attendant le rechargement.
  const [sizes, setSizes] = useState<Record<string, NoteSize>>({});
  const [resizing, setResizing] = useState<string | null>(null);
  const sizeOf = (n: PersonalNote): NoteSize => sizes[n.id] ?? { width: n.width ?? 1, height: n.height ?? NOTE_DEFAULT_HEIGHT };

  async function update(n: PersonalNote, patch: Partial<Pick<PersonalNote, 'pinned' | 'archived'>>) {
    try {
      await api.updateNote(n, patch);
      if (patch.archived !== undefined) toast(patch.archived ? 'Note archivée.' : 'Note sortie des archives.');
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function saveSize(n: PersonalNote, size: NoteSize) {
    if (size.width === (n.width ?? 1) && size.height === (n.height ?? NOTE_DEFAULT_HEIGHT)) {
      setSizes(({ [n.id]: _, ...rest }) => rest);
      return;
    }
    setSizes((s) => ({ ...s, [n.id]: size }));
    try {
      await api.updateNote(n, size);
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSizes(({ [n.id]: _, ...rest }) => rest);
    }
  }

  // Le pointeur est suivi sur toute la fenêtre : la carte change de taille (et parfois de place) pendant le geste.
  function startResize(e: React.PointerEvent<HTMLButtonElement>, n: PersonalNote) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const card = e.currentTarget.closest<HTMLElement>('.note-card');
    const body = card?.querySelector<HTMLElement>('.note-body');
    if (!card || !body) return;
    const start = { x: e.clientX, y: e.clientY, width: card.getBoundingClientRect().width, height: body.getBoundingClientRect().height };
    const from = sizeOf(n);
    let current = from;
    setResizing(n.id);
    const move = (ev: PointerEvent) => {
      const w = start.width + ev.clientX - start.x;
      const width = clamp(Math.round((w + grid.gap) / (grid.colWidth + grid.gap)), 1, Math.min(NOTE_MAX_WIDTH, grid.cols));
      const height = clamp(Math.round(start.height + ev.clientY - start.y), NOTE_MIN_HEIGHT, NOTE_MAX_HEIGHT);
      // Sur un écran étroit, la largeur choisie sur un grand écran est gardée.
      const next = { width: grid.cols < from.width && width === grid.cols ? from.width : width, height };
      if (next.width === current.width && next.height === current.height) return;
      current = next;
      setSizes((s) => ({ ...s, [n.id]: next }));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setResizing(null);
      void saveSize(n, current);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  /** Clavier : ← → la largeur, ↑ ↓ la hauteur. */
  function keyResize(e: React.KeyboardEvent, n: PersonalNote, body: HTMLElement | null) {
    const s = sizeOf(n);
    const h = s.height || Math.round(body?.getBoundingClientRect().height ?? NOTE_DEFAULT_HEIGHT);
    const next =
      e.key === 'ArrowRight' ? { ...s, width: Math.min(s.width + 1, NOTE_MAX_WIDTH, grid.cols) }
      : e.key === 'ArrowLeft' ? { ...s, width: Math.max(1, Math.min(s.width, grid.cols) - 1) }
      : e.key === 'ArrowDown' ? { ...s, height: clamp(h + 40, NOTE_MIN_HEIGHT, NOTE_MAX_HEIGHT) }
      : e.key === 'ArrowUp' ? { ...s, height: clamp(h - 40, NOTE_MIN_HEIGHT, NOTE_MAX_HEIGHT) }
      : null;
    if (!next) return;
    e.preventDefault();
    void saveSize(n, next);
  }

  /** Double-clic : la note entière, ou de nouveau la taille par défaut. */
  function toggleFull(n: PersonalNote) {
    const s = sizeOf(n);
    void saveSize(n, s.height === 0 ? { width: 1, height: NOTE_DEFAULT_HEIGHT } : { ...s, height: 0 });
  }

  return (
    <div className={resizing ? 'note-grid resizing' : 'note-grid'} ref={gridRef}>
      {notes.map((n) => {
        const project = n.projectId ? projects.find((p) => p.id === n.projectId) : null;
        const size = sizeOf(n);
        return (
          <article
            key={n.id}
            className={['note-card', n.pinned && !n.archived && 'pinned', n.archived && 'archived', resizing === n.id && 'resizing'].filter(Boolean).join(' ')}
            style={size.width > 1 ? { gridColumn: `span ${Math.min(size.width, grid.cols)}` } : undefined}
          >
            <div className="note-head">
              <button className="note-open" onClick={() => onOpen(n)} title="Ouvrir la note">
                {n.title || <span className="muted">Sans titre</span>}
              </button>
              <span className="note-tools">
                {!n.archived && (
                  <button className={n.pinned ? 'btn-icon note-pin on' : 'btn-icon note-pin'} title={n.pinned ? 'Désépingler' : 'Épingler en tête'} onClick={() => void update(n, { pinned: !n.pinned })}>📌</button>
                )}
                <button className="btn-icon note-pin" title={n.archived ? 'Sortir des archives' : 'Archiver'} onClick={() => void update(n, { archived: !n.archived })}>{n.archived ? '↩' : '🗄'}</button>
              </span>
            </div>
            <NoteBody note={n} height={size.height} onOpen={() => onOpen(n)} />
            <div className="note-foot muted small">
              {n.ownerId !== me.email && <span className="badge" title={n.createdBy !== n.ownerId ? `Ajoutée par ${name(n.createdBy)}` : undefined}>{name(n.ownerId)}</span>}
              {n.ownerId === me.email && n.createdBy !== me.email && <span title="Note ajoutée par un administrateur">✍ {name(n.createdBy)}</span>}
              {showProject && project && <Link to={`/projets/${project.id}?onglet=todo`}>📁 {project.name}</Link>}
              <span title={`Modifiée le ${formatDateTime(n.updatedAt)}`}>{formatDate(n.updatedAt.slice(0, 10))}</span>
            </div>
            <button
              className="note-resize"
              title="Glisser pour agrandir ou réduire le post-it (flèches au clavier) · double-clic : la note entière"
              aria-label={`Taille de la note « ${n.title || 'Sans titre'} »`}
              onPointerDown={(e) => startResize(e, n)}
              onDoubleClick={() => toggleFull(n)}
              onKeyDown={(e) => keyResize(e, n, e.currentTarget.parentElement?.querySelector('.note-body') ?? null)}
            />
          </article>
        );
      })}
    </div>
  );
}

/** Texte du post-it, coupé à la hauteur choisie (fondu en bas seulement s'il dépasse). */
function NoteBody({ note, height, onOpen }: { note: PersonalNote; height: number; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [height, note.content]);
  return (
    <div ref={ref} className={overflows ? 'note-body cut' : 'note-body'} style={{ maxHeight: height ? `${height}px` : 'none' }} onClick={onOpen}>
      <MarkdownView markdown={note.content} />
    </div>
  );
}

/** Création ou modification d'une note : titre, texte (Markdown), projet. */
export function NoteModal({
  note,
  defaults,
  projects,
  onClose,
  onSaved,
}: {
  note: PersonalNote | null;
  defaults?: { projectId?: string; ownerId?: string };
  projects: ProjectRef[];
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const [f, setF] = useState({
    title: note?.title ?? '',
    content: note?.content ?? '',
    projectId: note ? note.projectId : (defaults?.projectId ?? ''),
    pinned: note?.pinned ?? false,
    archived: note?.archived ?? false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const { me } = useAuth();
  const { name } = useUsers();
  const [ownerId, setOwnerId] = useState(note?.ownerId ?? (defaults?.ownerId || me.email));

  async function save() {
    if (note) await api.updateNote(note, f);
    else await api.createNote({ ...f, ownerId });
    await onSaved();
  }

  async function archive() {
    if (!note) return;
    try {
      await api.updateNote(note, { ...f, archived: !f.archived });
      toast(f.archived ? 'Note sortie des archives.' : 'Note archivée.');
      onClose();
      await onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function remove() {
    if (!note || !confirm('Supprimer cette note ?')) return;
    try {
      await api.deleteNote(note);
      toast('Note supprimée.');
      onClose();
      await onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <ItemModal
      title={note ? 'Note' : 'Nouvelle note'}
      onClose={onClose}
      onSave={save}
      wide
      canSave={!!(f.title.trim() || f.content.trim())}
      extraFooter={
        note && (
          <>
            <button className="btn btn-danger-ghost" onClick={() => void remove()}>Supprimer</button>
            <button className="btn btn-ghost" onClick={() => void archive()}>{f.archived ? '↩ Sortir des archives' : '🗄 Archiver'}</button>
            <span className="muted small">
              Créée le {formatDate(note.createdAt.slice(0, 10))}
              {note.createdBy !== note.ownerId && ` par ${name(note.createdBy)}`}
            </span>
          </>
        )
      }
    >
      {me.permissions.manageAllNotes && (
        <label className="field span-2">
          <span>Note de</span>
          {note ? <input className="input" value={name(note.ownerId)} disabled /> : <UserSelect value={ownerId} onChange={setOwnerId} />}
        </label>
      )}
      <label className="field">
        <span>Titre</span>
        <input className="input" autoFocus value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Facultatif" />
      </label>
      <label className="field">
        <span>Projet</span>
        <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} projects={projects} emptyLabel="Aucun" />
      </label>
      <div className="field span-2">
        <span>Note</span>
        <MarkdownField value={f.content} onChange={(v) => set('content', v)} placeholder="Idées, informations, liens…" resetKey={note?.id ?? 'nouvelle'} />
      </div>
      <label className="field span-2">
        <label className="check">
          <input type="checkbox" checked={f.pinned} onChange={(e) => set('pinned', e.target.checked)} /> Épinglée en tête de liste
        </label>
      </label>
      <p className="muted small span-2">
        {ownerId === me.email ? 'Vos notes sont personnelles : seuls les administrateurs peuvent aussi les voir.' : `Note visible par ${name(ownerId)} et les administrateurs.`}
      </p>
    </ItemModal>
  );
}
