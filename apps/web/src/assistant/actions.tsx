import { useState } from 'react';
import { Link } from 'react-router';
import { NO_PROJECT_ID, PRIORITY_LABELS, ticketKey, type AssistantAction, type Task } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Spinner, formatDate } from '../components/ui';
import { useSettings } from '../settings/context';
import { ProjectSelect, defaultDueDate, type ProjectRef } from '../tasks/tasks';
import { useAssistant } from '../theme';
import { UserSelect } from '../users/context';

/**
 * Propositions de Gandalf (« Dois-je créer un ticket dans le projet X pour … ? ») : rien n'est créé sans un clic sur
 * « Créer ». L'élément est créé par le navigateur, par les routes habituelles et avec les droits de l'utilisateur ;
 * on peut auparavant retoucher l'intitulé, le projet et la date.
 */

export type ActionState = { state: 'proposee' } | { state: 'ignoree' } | { state: 'creee'; label: string; path: string };
export type ChatAction = AssistantAction & { status?: ActionState };

const TITLE: Record<AssistantAction['kind'], string> = { ticket: 'Ticket', todo: 'To-do', jalon: 'Jalon', ticket_update: 'Mise à jour' };

/** « Dois-je créer un ticket dans le projet X ? » */
function question(kind: AssistantAction['kind'], project: ProjectRef | undefined) {
  const p = project && <strong>{project.name}</strong>;
  if (kind === 'ticket') return p ? <>Dois-je créer un ticket dans le projet {p} ?</> : <>Dois-je créer un ticket hors projet ?</>;
  if (kind === 'todo') return p ? <>Dois-je ajouter une tâche à la to-do du projet {p} ?</> : <>Dois-je ajouter une tâche à votre to-do ?</>;
  return p ? <>Dois-je ajouter un jalon au projet {p} ?</> : <>Dois-je ajouter un jalon ? Choisissez son projet.</>;
}

export function ActionCard({ action, projects, onChange }: { action: ChatAction; projects: ProjectRef[]; onChange: (a: ChatAction) => void }) {
  if (action.update) return <UpdateCard action={action} onChange={onChange} />;
  return <CreateCard action={action} projects={projects} onChange={onChange} />;
}

/** « Dois-je mettre à jour T-12 ? » : les changements (avant → après), appliqués au clic, par la route habituelle. */
function UpdateCard({ action, onChange }: { action: ChatAction; onChange: (a: ChatAction) => void }) {
  const { label } = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const u = action.update!;
  const status = action.status ?? { state: 'proposee' };
  const set = (patch: Partial<ChatAction>) => onChange({ ...action, ...patch });
  const path = action.projectId === NO_PROJECT_ID ? '/sprints?onglet=liste' : `/projets/${action.projectId}?onglet=tickets`;

  async function apply() {
    setBusy(true);
    setError('');
    try {
      await api.updateItem(action.projectId, 'tasks', u.ticketId, { ...(u.status ? { status: u.status } : {}), ...(u.dueDate ? { dueDate: u.dueDate } : {}), ...(u.priority ? { priority: u.priority } : {}) });
      set({ status: { state: 'creee', label: `${ticketKey(u)} mis à jour`, path } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status.state === 'creee') {
    return (
      <div className="gandalf-action done">
        <span>✓ {status.label} : <Link to={status.path}>{action.title}</Link></span>
      </div>
    );
  }
  if (status.state === 'ignoree') {
    return (
      <div className="gandalf-action ignored">
        <span className="muted small">Ignoré : mise à jour de {ticketKey(u)}</span>
        <button className="btn-link small" onClick={() => set({ status: { state: 'proposee' } })}>Reprendre</button>
      </div>
    );
  }
  return (
    <div className="gandalf-action">
      <p className="gandalf-action-q">
        Dois-je mettre à jour <strong>{ticketKey(u)}</strong> « {action.title} »{action.projectName && <> ({action.projectName})</>} ?
      </p>
      <ul className="gandalf-changes small">
        {u.status && <li>Statut : {label('ticket', u.before.status)} → <strong>{label('ticket', u.status)}</strong></li>}
        {u.dueDate && <li>Échéance : {u.before.dueDate ? formatDate(u.before.dueDate) : 'aucune'} → <strong>{formatDate(u.dueDate)}</strong></li>}
        {u.priority && <li>Priorité : {PRIORITY_LABELS[u.before.priority].toLowerCase()} → <strong>{PRIORITY_LABELS[u.priority].toLowerCase()}</strong></li>}
      </ul>
      {action.reason && <p className="small muted gandalf-action-why">{action.reason}</p>}
      {error && <p className="small due-late">{error}</p>}
      <div className="gandalf-action-buttons">
        <button className="btn btn-sm" disabled={busy} onClick={() => set({ status: { state: 'ignoree' } })}>Ignorer</button>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void apply()}>{busy && <Spinner small />} Mettre à jour</button>
      </div>
    </div>
  );
}

function CreateCard({ action, projects, onChange }: { action: ChatAction; projects: ProjectRef[]; onChange: (a: ChatAction) => void }) {
  const { me } = useAuth();
  const assistant = useAssistant();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = action.status ?? { state: 'proposee' };
  const set = (patch: Partial<ChatAction>) => onChange({ ...action, ...patch });
  const project = projects.find((p) => p.id === action.projectId);
  const needsProject = action.kind === 'jalon' && !action.projectId;
  const needsDate = action.kind === 'jalon' && !action.dueDate;

  async function create() {
    setBusy(true);
    setError('');
    const details = [action.details, `_Proposé par ${assistant.name}._`].filter(Boolean).join('\n\n');
    try {
      let done: ActionState;
      if (action.kind === 'ticket') {
        const projectId = action.projectId || NO_PROJECT_ID;
        const t = (await api.createItem(projectId, 'tasks', { title: action.title, type: action.ticketType, details, priority: action.priority, dueDate: action.dueDate, assigneeId: action.assigneeId || me.email })) as Task;
        done = { state: 'creee', label: `Ticket ${ticketKey(t)} créé`, path: action.projectId ? `/projets/${action.projectId}?onglet=tickets` : '/sprints?onglet=liste' };
      } else if (action.kind === 'todo') {
        await api.createTodo({ title: action.title, details: action.details, dueDate: action.dueDate || defaultDueDate(), projectId: action.projectId, assigneeId: action.assigneeId || me.email });
        done = { state: 'creee', label: 'Ajoutée à la to-do', path: action.projectId ? `/projets/${action.projectId}?onglet=todo` : '/todo' };
      } else {
        await api.createItem(action.projectId, 'jalons', { label: action.title, date: action.dueDate });
        done = { state: 'creee', label: 'Jalon ajouté', path: `/projets/${action.projectId}?onglet=planning` };
      }
      set({ status: done });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (status.state === 'creee') {
    return (
      <div className="gandalf-action done">
        <span>✓ {status.label} : <Link to={status.path}>{action.title}</Link></span>
      </div>
    );
  }
  if (status.state === 'ignoree') {
    return (
      <div className="gandalf-action ignored">
        <span className="muted small">Ignoré : {action.title}</span>
        <button className="btn-link small" onClick={() => set({ status: { state: 'proposee' } })}>Reprendre</button>
      </div>
    );
  }
  return (
    <div className="gandalf-action">
      <p className="gandalf-action-q">{question(action.kind, project)}</p>
      <label className="gandalf-action-field">
        <span className="small muted">{TITLE[action.kind]}{action.kind === 'ticket' && action.ticketType && ` · ${action.ticketType}`}</span>
        <input className="input input-sm" value={action.title} onChange={(e) => set({ title: e.target.value })} aria-label="Intitulé" />
      </label>
      <div className="gandalf-action-row">
        <ProjectSelect
          value={action.projectId}
          onChange={(id) => set({ projectId: id, projectName: projects.find((p) => p.id === id)?.name ?? '' })}
          projects={projects}
          emptyLabel={action.kind === 'jalon' ? 'Choisir le projet…' : action.kind === 'ticket' ? 'Aucun projet' : 'Aucun (tâche personnelle)'}
        />
        {action.kind !== 'jalon' && (
          <UserSelect className="input input-sm" value={action.assigneeId || me.email} onChange={(email) => set({ assigneeId: email })} />
        )}
        <input className="input input-sm" type="date" value={action.dueDate} onChange={(e) => set({ dueDate: e.target.value })} aria-label={action.kind === 'jalon' ? 'Date du jalon' : 'Échéance'} title={action.kind === 'jalon' ? 'Date du jalon' : 'Échéance'} />
      </div>
      {(action.details || action.reason) && (
        <p className="small muted gandalf-action-why">
          {action.kind === 'ticket' && action.priority !== 'normale' && <>Priorité {PRIORITY_LABELS[action.priority].toLowerCase()}. </>}
          {action.details || action.reason}
        </p>
      )}
      {error && <p className="small due-late">{error}</p>}
      <div className="gandalf-action-buttons">
        <button className="btn btn-sm" disabled={busy} onClick={() => set({ status: { state: 'ignoree' } })}>Ignorer</button>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || !action.title.trim() || needsProject || needsDate}
          title={needsProject ? 'Choisissez le projet du jalon' : needsDate ? 'Indiquez la date du jalon' : undefined}
          onClick={() => void create()}
        >
          {busy && <Spinner small />} Créer
        </button>
      </div>
    </div>
  );
}
