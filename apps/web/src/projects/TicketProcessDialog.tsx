import { useState } from 'react';
import { PRIORITIES, PRIORITY_LABELS, TICKET_PROCESS_STEPS, ticketProcessTickets, type Priority, type Sprint } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Modal, Spinner, toast } from '../components/ui';
import { UserSelect } from '../users/context';
import { sprintLabel } from '../sprints/tickets';
import { useProject } from './common';

type Step = (typeof TICKET_PROCESS_STEPS)[number];

/**
 * Process complet d'un projet : les tickets Cadrage, Dev, Recette, Correctif et MEP créés d'un coup, dans l'ordre,
 * titrés « [DEV] - Nom du projet » (avec une précision facultative). On peut décocher une étape.
 */
export function TicketProcessDialog({ sprints, onClose }: { sprints: Sprint[]; onClose: () => void }) {
  const { project, setProject } = useProject();
  const { me } = useAuth();
  const [steps, setSteps] = useState<Step[]>([...TICKET_PROCESS_STEPS]);
  const [complement, setComplement] = useState('');
  const [priority, setPriority] = useState<Priority>('normale');
  const [assigneeId, setAssigneeId] = useState(me.email);
  const [sprintId, setSprintId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const titles = ticketProcessTickets(project.name, steps, complement);
  const toggle = (s: Step) => setSteps((xs) => (xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s]));

  async function create() {
    setBusy(true);
    setError(null);
    try {
      setProject(await api.ticketProcess(project.id, { steps, complement, priority, assigneeId, sprintId: sprintId ? Number(sprintId) : null }));
      toast(`${titles.length} ticket${titles.length > 1 ? 's' : ''} créé${titles.length > 1 ? 's' : ''}.`);
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Créer un process complet"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!steps.length || busy} onClick={() => void create()}>
            {busy && <Spinner small />} Créer {titles.length} ticket{titles.length > 1 ? 's' : ''}
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <p className="muted small">
        Un ticket par étape, créés d’un coup et dans l’ordre : le premier est à faire, les suivants en attente. Quand vous en terminez un, le hub propose de passer à
        l’étape suivante. Décochez les étapes inutiles.
      </p>
      <div className="process-steps">
        {TICKET_PROCESS_STEPS.map((s) => (
          <label key={s} className={steps.includes(s) ? 'process-step on' : 'process-step'}>
            <input type="checkbox" checked={steps.includes(s)} onChange={() => toggle(s)} /> {s}
          </label>
        ))}
      </div>
      <div className="form-grid">
        <label className="field span-2">
          <span>Précision <span className="muted">(facultative, ajoutée au titre)</span></span>
          <input className="input" value={complement} maxLength={200} onChange={(e) => setComplement(e.target.value)} placeholder="ex. Export des commandes" />
        </label>
        <label className="field">
          <span>Responsable</span>
          <UserSelect value={assigneeId} onChange={setAssigneeId} />
        </label>
        <label className="field">
          <span>Priorité</span>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
          </select>
        </label>
        <label className="field span-2">
          <span>Sprint</span>
          <select className="input" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            <option value="">Backlog (à planifier plus tard)</option>
            {sprints.map((s) => <option key={s.id} value={s.id}>{sprintLabel(s)}</option>)}
          </select>
        </label>
      </div>
      {titles.length > 0 && (
        <ol className="process-preview small">
          {titles.map((t, i) => (
            <li key={t.type}>
              <strong>{t.type}</strong> — {t.title} <span className="muted">({i === 0 ? 'à faire' : 'en attente'})</span>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
