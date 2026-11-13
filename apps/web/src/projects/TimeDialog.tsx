import { useState } from 'react';
import { formatDuration, parseDuration, projectSpentHours, todayIso } from '@samm/shared';
import { useAuth } from '../auth';
import { api } from '../api';
import { ErrorBox, Modal, Spinner, formatDate, toast } from '../components/ui';
import { HoursInput } from '../sprints/tickets';
import { UserSelect, useUsers } from '../users/context';
import { useItemActions, useProject } from './common';

/** Temps passé sur le projet : total (tickets + hors ticket), saisie et liste du temps passé hors ticket. */
export function TimeDialog({ onClose }: { onClose: () => void }) {
  const { project, reload } = useProject();
  const { email } = useAuth();
  const { name } = useUsers();
  const actions = useItemActions();
  const [f, setF] = useState({ date: todayIso(), duration: '', label: '', userId: email });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const hours = parseDuration(f.duration);
  const spent = projectSpentHours(project.items);

  async function add() {
    if (!hours) return;
    setSaving(true);
    setError(null);
    try {
      await api.createItem(project.id, 'times', { date: f.date, hours, label: f.label, userId: f.userId });
      await reload();
      setF((x) => ({ ...x, duration: '', label: '' }));
      toast('Temps enregistré.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Temps passé" onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Fermer</button>}>
      <p>
        <strong>{formatDuration(spent.total)}</strong> au total : {formatDuration(spent.tickets)} sur les tickets, {formatDuration(spent.other)} hors ticket.
      </p>
      <h3>Ajouter du temps hors ticket</h3>
      <p className="muted small">Réunions, cadrage, suivi… tout ce qui n’a pas de ticket. Jours de 8 h : « 1j 4h », « 2h30 ».</p>
      <ErrorBox error={error} />
      <div
        className="form-grid"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hours && !saving) void add();
        }}
      >
        <label className="field">
          <span>Durée *</span>
          <HoursInput label="Durée" value={f.duration} onChange={(v) => set('duration', v)} />
        </label>
        <label className="field">
          <span>Jour</span>
          <input className="input" type="date" value={f.date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <label className="field">
          <span>Qui</span>
          <UserSelect value={f.userId} onChange={(v) => set('userId', v)} />
        </label>
        <label className="field">
          <span>Pour quoi</span>
          <input className="input" value={f.label} maxLength={300} onChange={(e) => set('label', e.target.value)} placeholder="ex. Comité de pilotage" />
        </label>
      </div>
      <div className="toolbar-row">
        <button className="btn btn-primary" disabled={!hours || saving} onClick={() => void add()}>{saving && <Spinner small />} Ajouter</button>
      </div>
      {project.items.times.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Jour</th>
                <th>Qui</th>
                <th>Pour quoi</th>
                <th className="num">Durée</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {project.items.times.map((t) => (
                <tr key={t.id}>
                  <td>{t.date ? formatDate(t.date) : '—'}</td>
                  <td>{t.userId ? name(t.userId) : '—'}</td>
                  <td>{t.label || <span className="muted">—</span>}</td>
                  <td className="num">{formatDuration(t.hours)}</td>
                  <td className="num">
                    <button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('times', t.id, `${formatDuration(t.hours)}${t.label ? ` — ${t.label}` : ''}`)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
