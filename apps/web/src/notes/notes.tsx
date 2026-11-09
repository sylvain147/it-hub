import { useState } from 'react';
import { Link } from 'react-router';
import type { PersonalNote } from '@samm/shared';
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

/** Notes en cartes : épinglées d'abord. Un clic ouvre la note. */
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
  async function update(n: PersonalNote, patch: Partial<Pick<PersonalNote, 'pinned' | 'archived'>>) {
    try {
      await api.updateNote(n, patch);
      if (patch.archived !== undefined) toast(patch.archived ? 'Note archivée.' : 'Note sortie des archives.');
      await onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <div className="note-grid">
      {notes.map((n) => {
        const project = n.projectId ? projects.find((p) => p.id === n.projectId) : null;
        return (
          <article key={n.id} className={['note-card', n.pinned && !n.archived && 'pinned', n.archived && 'archived'].filter(Boolean).join(' ')}>
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
            <div className="note-body" onClick={() => onOpen(n)}>
              <MarkdownView markdown={n.content} />
            </div>
            <div className="note-foot muted small">
              {n.ownerId !== me.email && <span className="badge" title={n.createdBy !== n.ownerId ? `Ajoutée par ${name(n.createdBy)}` : undefined}>{name(n.ownerId)}</span>}
              {n.ownerId === me.email && n.createdBy !== me.email && <span title="Note ajoutée par un administrateur">✍ {name(n.createdBy)}</span>}
              {showProject && project && <Link to={`/projets/${project.id}?onglet=todo`}>📁 {project.name}</Link>}
              <span title={`Modifiée le ${formatDateTime(n.updatedAt)}`}>{formatDate(n.updatedAt.slice(0, 10))}</span>
            </div>
          </article>
        );
      })}
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
