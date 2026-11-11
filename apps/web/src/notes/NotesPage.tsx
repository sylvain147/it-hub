import { useState } from 'react';
import { useSearchParams } from 'react-router';
import type { PersonalNote } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { useProjectRefs } from '../tasks/tasks';
import { NoteGrid, NoteModal, NoteQuickAdd } from './notes';
import { useAuth } from '../auth';
import { useUsers } from '../users/context';
import { MeetingPanel } from '../meetings/MeetingPanel';
import { useMeetingRecorder } from '../meetings/recorder';

/**
 * Mes notes en vrac : recherche, filtre par projet. Les administrateurs choisissent de qui voir les notes.
 * On y transcrit aussi une réunion en direct (`?reunion`, avec `&projet=` pour présélectionner le projet).
 */
export function NotesPage() {
  const { me } = useAuth();
  const { name, active } = useUsers();
  const [params, setParams] = useSearchParams();
  const scope = me.permissions.manageAllNotes ? (params.get('qui') ?? me.email) : me.email;
  const data = useLoad(() => api.notes({ user: scope === me.email ? undefined : scope }), [scope]);
  const projects = useProjectRefs();
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [editing, setEditing] = useState<PersonalNote | 'new' | null>(null);

  // Les notes archivées sont rangées à part (`?vue=archives`).
  const archives = params.get('vue') === 'archives';
  const setArchives = (on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (on) next.set('vue', 'archives');
        else next.delete('vue');
        return next;
      },
      { replace: true },
    );
  const recorder = useMeetingRecorder();
  const meeting = params.has('reunion');
  const setMeeting = (on: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (on) next.set('reunion', '1');
        else {
          next.delete('reunion');
          next.delete('projet');
        }
        return next;
      },
      { replace: true },
    );
  const archivedCount = (data.data ?? []).filter((n) => n.archived).length;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const notes = (data.data ?? []).filter(
    (n) =>
      n.archived === archives &&
      (!project || (project === 'aucun' ? !n.projectId : n.projectId === project)) &&
      words.every((w) => `${n.title} ${n.content} ${scope === 'all' ? name(n.ownerId) : ''}`.toLowerCase().includes(w)),
  );
  const used = projects.filter((p) => (data.data ?? []).some((n) => n.projectId === p.id));
  const reload = async () => {
    await data.reload();
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Notes</h1>
          <p className="muted small">
            {scope === me.email
              ? 'Mon bloc-notes, en vrac, rattaché ou non à un projet. Personnel : seuls les administrateurs peuvent aussi voir vos notes.'
              : scope === 'all'
                ? 'Les notes de toute l’équipe.'
                : `Les notes de ${name(scope)}.`}
          </p>
        </div>
        <div className="actions">
          {me.permissions.manageAllNotes && (
            <select className="input input-auto" value={scope} onChange={(e) => setParams(e.target.value === me.email ? {} : { qui: e.target.value }, { replace: true })} aria-label="Notes de">
              <option value={me.email}>Mes notes</option>
              <option value="all">Toute l’équipe</option>
              {active.filter((u) => u.email !== me.email).map((u) => <option key={u.email} value={u.email}>{u.name}</option>)}
            </select>
          )}
          {!meeting && (
            <button className="btn" onClick={() => setMeeting(true)}>
              {recorder.recording ? <><span className="rec-dot" /> Transcription en cours</> : '🎙️ Transcrire une réunion'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nouvelle note</button>
        </div>
      </div>

      {meeting && (
        <section className="card">
          <MeetingPanel projectId={params.get('projet') ?? undefined} onClose={() => setMeeting(false)} onNoteSaved={reload} />
        </section>
      )}

      <section className="card">
        {scope !== 'all' && <NoteQuickAdd ownerId={scope === me.email ? undefined : scope} onAdded={reload} />}
        <div className="toolbar-row mt">
          <div className="seg" role="group" aria-label="Notes affichées">
            <button className={archives ? '' : 'on'} onClick={() => setArchives(false)}>Notes</button>
            <button className={archives ? 'on' : ''} onClick={() => setArchives(true)}>🗄 Archivées{archivedCount ? ` (${archivedCount})` : ''}</button>
          </div>
          <input className="input input-auto" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher" />
          <select className="input input-auto" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Projet">
            <option value="">Tous les projets</option>
            <option value="aucun">Hors projet</option>
            {used.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </section>

      <ErrorBox error={data.error} />
      {data.loading && !data.data && <Spinner />}
      {data.data && !data.data.length && <EmptyState>Aucune note pour l’instant. Notez une idée, une info glanée en réunion, un lien…</EmptyState>}
      {data.data && data.data.length > 0 && !notes.length && (
        <EmptyState>{archives && !archivedCount ? 'Aucune note archivée. Archivez une note (🗄) pour la ranger sans la supprimer.' : 'Aucune note ne correspond.'}</EmptyState>
      )}
      {notes.length > 0 && <NoteGrid notes={notes} projects={projects} onOpen={setEditing} onChanged={reload} />}
      {editing && <NoteModal note={editing === 'new' ? null : editing} defaults={{ projectId: project === 'aucun' ? '' : project, ownerId: scope === 'all' ? me.email : scope }} projects={projects} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
