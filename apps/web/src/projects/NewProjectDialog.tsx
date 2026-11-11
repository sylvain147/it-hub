import { useState } from 'react';
import { useNavigate } from 'react-router';
import { HEALTH_LABELS, PRIORITIES, PRIORITY_LABELS, type Priority, type ProjectDetail, type ProjectStatus } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Modal, Spinner } from '../components/ui';
import { StatusOptions, useSettings } from '../settings/context';
import { DomainChoices } from './OverviewTab';
import { UserChoices } from '../users/context';

/**
 * Création d'un projet : depuis la liste des projets (on ouvre ensuite sa page), ou depuis la fiche d'une tâche
 * de la to-do (`onCreated` : le nouveau projet est choisi sans quitter la tâche).
 */
export function NewProjectDialog({ initialName = '', onClose, onCreated }: { initialName?: string; onClose: () => void; onCreated?: (p: ProjectDetail) => void }) {
  const { email } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('cadrage');
  const [priority, setPriority] = useState<Priority>('normale');
  const [chefs, setChefs] = useState([email]);
  const [demandeur, setDemandeur] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const { lists } = useSettings();
  const [targetDate, setTargetDate] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const p = await api.createProject({ name, code, status, priority, chefDeProjetIds: chefs, demandeur, domains, targetDate, description });
      if (onCreated) onCreated(p);
      else navigate(`/projets/${p.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nouveau projet"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>
            {busy && <Spinner small />} Créer le projet
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      {/* Ouverte depuis la fiche d’une tâche : les touches ne remontent pas à celle-ci (Ctrl + Entrée l’enregistrerait). */}
      <div className="form-grid" onKeyDown={(e) => e.stopPropagation()}>
        <label className="field span-2">
          <span>Nom du projet *</span>
          <input className="input input-title" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Migration de l’offre Coliéco" onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} />
        </label>
        <label className="field">
          <span>Code</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ex. TC-300" />
        </label>
        <label className="field">
          <span>Date de fin visée</span>
          <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Statut</span>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            <StatusOptions list="project" current={status} />
          </select>
        </label>
        <label className="field">
          <span>Priorité</span>
          <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((s) => <option key={s} value={s}>{PRIORITY_LABELS[s]}</option>)}
          </select>
        </label>
        <div className="field span-2">
          <span>Chefs de projet <span className="muted">(un ou plusieurs)</span></span>
          <UserChoices value={chefs} onChange={setChefs} />
        </div>
        <label className="field">
          <span>Demandeur (direction, service)</span>
          <input className="input" value={demandeur} onChange={(e) => setDemandeur(e.target.value)} placeholder="ex. Logistique" />
        </label>
        <div className="field">
          <span>Domaines</span>
          <DomainChoices value={domains} onChange={setDomains} options={lists.projectDomains} />
        </div>
        <label className="field span-2">
          <span>Description <span className="muted">(facultatif, complétable ensuite)</span></span>
          <textarea className="input" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Le contexte, le besoin, en quelques phrases." />
        </label>
      </div>
      <p className="muted small">Météo : {HEALTH_LABELS.vert} par défaut. Vous pourrez ensuite ajouter intervenants, prestations, planning, documents…</p>
    </Modal>
  );
}
