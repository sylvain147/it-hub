import { useState } from 'react';
import type { PersonalNote } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner } from '../components/ui';
import { useProjectRefs } from '../tasks/tasks';
import { NoteGrid, NoteModal, NoteQuickAdd } from './notes';

/** Mes notes en vrac : recherche, filtre par projet. */
export function NotesPage() {
  const data = useLoad(() => api.notes(), []);
  const projects = useProjectRefs();
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [editing, setEditing] = useState<PersonalNote | 'new' | null>(null);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const notes = (data.data ?? []).filter(
    (n) =>
      (!project || (project === 'aucun' ? !n.projectId : n.projectId === project)) &&
      words.every((w) => `${n.title} ${n.content}`.toLowerCase().includes(w)),
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
          <p className="muted small">Mon bloc-notes, en vrac, rattaché ou non à un projet. Personnel : personne d’autre ne voit vos notes.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nouvelle note</button>
        </div>
      </div>

      <section className="card">
        <NoteQuickAdd onAdded={reload} />
        <div className="toolbar-row mt">
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
      {data.data && data.data.length > 0 && !notes.length && <EmptyState>Aucune note ne correspond.</EmptyState>}
      {notes.length > 0 && <NoteGrid notes={notes} projects={projects} onOpen={setEditing} onChanged={reload} />}
      {editing && <NoteModal note={editing === 'new' ? null : editing} defaults={{ projectId: project === 'aucun' ? '' : project }} projects={projects} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
