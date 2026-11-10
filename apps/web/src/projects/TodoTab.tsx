import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { PersonalNote } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox } from '../components/ui';
import { byPosition, defaultDueDate, QuickAdd, TaskChecklist, TaskModal, todoRow, useProjectRefs, type TaskRow } from '../tasks/tasks';
import { NoteGrid, NoteModal, NoteQuickAdd } from '../notes/notes';
import { useUsers } from '../users/context';
import { useProject } from './common';

/** To-do du projet (partagée par l'équipe, distincte des tickets) et mes notes sur le projet (personnelles). */
export function TodoTab() {
  const { project } = useProject();
  const { me } = useAuth();
  const { name } = useUsers();
  const projects = useProjectRefs();
  const todos = useLoad(() => api.projectTodos(project.id), [project.id]);
  const notes = useLoad(() => api.notes({ projectId: project.id }), [project.id]);
  // Lien depuis le planning : `?tache=` met la tâche en évidence.
  const focusId = useSearchParams()[0].get('tache');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TaskRow | 'new' | null>(null);
  const [note, setNote] = useState<PersonalNote | 'new' | null>(null);

  const rows = (todos.data?.personal ?? []).map((t) => todoRow(t, name, projects));
  const open = rows.filter((t) => !t.done).sort(byPosition);
  const done = rows.filter((t) => t.done).sort((a, b) => b.doneAt.localeCompare(a.doneAt));
  const showDoneList = showDone || done.some((t) => t.id === focusId);
  const reloadTodos = async () => {
    await todos.reload();
  };
  const current = (notes.data ?? []).filter((n) => !n.archived);
  const archivedCount = (notes.data ?? []).length - current.length;
  const reloadNotes = async () => {
    await notes.reload();
  };

  return (
    <div>
      <section className="card">
        <div className="card-head">
          <h2>To-do du projet</h2>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nouvelle tâche</button>
        </div>
        <p className="muted small">
          Des choses à faire, à cocher, visibles de toute l’équipe. Elles ne vont pas dans les sprints : pour du travail à planifier, créez un{' '}
          <Link to={`/projets/${project.id}?onglet=tickets`}>ticket</Link>.
        </p>
        <div className="toolbar-row">
          <QuickAdd
            placeholder="Ajouter à la to-do du projet, pour aujourd’hui… (Entrée)"
            onAdd={async (title) => {
              await api.createTodo({ title, projectId: project.id, dueDate: defaultDueDate() });
              await todos.reload();
            }}
          />
        </div>
        <ErrorBox error={todos.error} />
        {todos.data && !open.length && <EmptyState>Rien à faire sur ce projet.</EmptyState>}
        {open.length > 0 && <TaskChecklist rows={open} onChanged={reloadTodos} onEdit={setEditing} showProject={false} reorderable focusId={focusId} />}
        {done.length > 0 && (
          <>
            <button className="btn btn-link mt" onClick={() => setShowDone(!showDoneList)}>
              {showDoneList ? 'Masquer' : 'Afficher'} les {done.length} tâche(s) faite(s)
            </button>
            {showDoneList && <TaskChecklist rows={done} onChanged={reloadTodos} onEdit={setEditing} showProject={false} focusId={focusId} />}
          </>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Mes notes sur le projet</h2>
          <Link to="/notes" className="small">Toutes mes notes →</Link>
        </div>
        <p className="muted small">Personnelles : personne d’autre ne les voit. Pour partager un compte rendu ou une décision, utilisez le journal.</p>
        <NoteQuickAdd projectId={project.id} onAdded={reloadNotes} />
        <ErrorBox error={notes.error} />
        {current.length > 0 && (
          <div className="mt">
            <NoteGrid notes={current} projects={projects} showProject={false} onOpen={setNote} onChanged={reloadNotes} />
          </div>
        )}
        {archivedCount > 0 && (
          <p className="mt small">
            <Link to="/notes?vue=archives">🗄 {archivedCount} note(s) archivée(s)</Link>
          </p>
        )}
      </section>

      {editing && <TaskModal task={editing === 'new' ? null : editing} defaults={{ assigneeId: me.email, projectId: project.id }} projects={projects} onClose={() => setEditing(null)} onSaved={reloadTodos} />}
      {note && <NoteModal note={note === 'new' ? null : note} defaults={{ projectId: project.id }} projects={projects} onClose={() => setNote(null)} onSaved={reloadNotes} />}
    </div>
  );
}
