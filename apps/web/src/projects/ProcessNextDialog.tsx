import { useEffect, useState } from 'react';
import { PROCESS_NEXT, processStepOf, projectStepIndex, ticketKey, type ProjectDetail, type ProjectStatus, type Task } from '@samm/shared';
import { api, TICKET_DONE, type TicketDoneDetail } from '../api';
import { Modal, Spinner, toast } from '../components/ui';
import { useSettings } from '../settings/context';
import { useTicketTypeLabel } from '../sprints/tickets';

interface Proposal {
  project: ProjectDetail;
  ticket: Task;
  /** Statuts proposés pour le projet (le premier en principal), seulement ceux qui le font avancer. */
  statuses: ProjectStatus[];
  /** Ticket de l'étape suivante, en attente, qui passera « À faire ». */
  next: Task | null;
}

/**
 * Quand un ticket du process (cadrage, dev, recette, correctif, MEP) est terminé, où que ce soit dans le hub : « Passer
 * en Planifié ? ». Accepter fait avancer le projet et passe « À faire » le ticket de l'étape suivante. Rien ne change
 * sans clic.
 */
export function ProcessNextDialog() {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const { label } = useSettings();
  const typeLabel = useTicketTypeLabel();

  useEffect(() => {
    async function onDone(e: Event) {
      const { projectId, ticket } = (e as CustomEvent<TicketDoneDetail>).detail;
      const step = processStepOf(ticket.type);
      if (!step) return;
      try {
        const project = await api.getProject(projectId);
        const { statuses, nextStep } = PROCESS_NEXT[step];
        const here = projectStepIndex(project.status);
        const ahead = statuses.filter((s) => projectStepIndex(s) > here);
        const next = nextStep
          ? (project.items.tasks.filter((t) => !t.done && t.status === 'attente' && processStepOf(t.type) === nextStep).sort((a, b) => a.number - b.number)[0] ?? null)
          : null;
        if (ahead.length || next) setProposal({ project, ticket, statuses: ahead, next });
      } catch {
        /* proposition facultative : rien à faire si le projet ne se lit pas */
      }
    }
    window.addEventListener(TICKET_DONE, onDone);
    return () => window.removeEventListener(TICKET_DONE, onDone);
  }, []);

  if (!proposal) return null;
  const { project, ticket, statuses, next } = proposal;

  async function accept(status: ProjectStatus | null) {
    setBusy(true);
    try {
      const r = await api.processNext(project.id, ticket.id, { projectStatus: status });
      toast(
        [status && `Projet passé « ${label('project', status)} »`, r.started && `ticket ${ticketKey(r.started)} à faire`].filter(Boolean).join(', ') + '.',
      );
      setProposal(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const main = statuses[0] ?? null;
  return (
    <Modal
      title={main ? `Passer en ${label('project', main)} ?` : `Démarrer l’étape ${typeLabel(next!.type)} ?`}
      onClose={() => setProposal(null)}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={() => setProposal(null)}>Pas maintenant</button>
          <span className="tb-flex" />
          {statuses.slice(1).map((s) => (
            <button key={s} className="btn" disabled={busy} onClick={() => void accept(s)}>Passer directement en {label('project', s)}</button>
          ))}
          <button className="btn btn-primary" disabled={busy} onClick={() => void accept(main)}>
            {busy && <Spinner small />} {main ? `Passer en ${label('project', main)}` : `Passer ${ticketKey(next!)} à faire`}
          </button>
        </>
      }
    >
      <p>
        🎉 Ticket <strong>{typeLabel(ticket.type)}</strong> ({ticketKey(ticket)}) terminé sur <strong>{project.name}</strong>.
      </p>
      <ul className="process-next">
        {main && (
          <li>
            Le projet passe de « {label('project', project.status)} » à <strong>« {label('project', main)} »</strong>
            {statuses.length > 1 && <> (ou directement « {statuses.slice(1).map((s) => label('project', s)).join(' », « ')} »)</>}.
          </li>
        )}
        {next ? (
          <li>
            Le ticket <strong>{typeLabel(next.type)}</strong> ({ticketKey(next)} — {next.title}) passe <strong>« À faire »</strong>.
          </li>
        ) : (
          main && <li className="muted">Aucun ticket en attente pour l’étape suivante.</li>
        )}
      </ul>
    </Modal>
  );
}
