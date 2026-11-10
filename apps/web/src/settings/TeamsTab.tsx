import { useEffect, useState } from 'react';
import { NOTIFICATION_EVENTS, NOTIFICATION_EVENT_LABELS, teamsWebhookError, type NotificationEvent } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorBox, Spinner, formatDateTime, shortUser, toast } from '../components/ui';

/** Connexion du hub à un canal Teams (flux Workflows) et choix des notifications envoyées. */
export function TeamsTab() {
  const data = useLoad(() => api.teamsSettings(), []);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = data.data;

  useEffect(() => {
    if (s && !s.connected) setEditing(true);
  }, [s]);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      await data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
      await data.reload();
    } finally {
      setBusy(false);
    }
  }

  if (data.loading && !s) return <Spinner />;
  if (!s) return <ErrorBox error={data.error} />;

  const urlError = url.trim() ? teamsWebhookError(url) : null;
  const saveUrl = () =>
    run(async () => {
      await api.saveTeamsSettings({ webhookUrl: url.trim() });
      setUrl('');
      setEditing(false);
      await api.testTeams();
    }, 'Connexion enregistrée : un message d’essai a été envoyé dans le canal.');
  const toggle = (e: NotificationEvent, on: boolean) => run(() => api.saveTeamsSettings({ events: { [e]: on } }), on ? 'Notification activée.' : 'Notification désactivée.');

  return (
    <>
      <p className="muted small">
        Le hub publie des messages dans un canal Teams de l’équipe. Le canal est lu par tous ses membres : seules des informations déjà visibles par toute
        l’équipe y sont envoyées.
      </p>
      <section className="card">
        <div className="card-head">
          <h2>Canal Teams</h2>
          {s.connected && <span className="badge badge-ok">Connecté</span>}
        </div>
        {s.connected && !editing && (
          <>
            <p className="small">
              Flux <code>{s.webhookHint}</code>
              {s.updatedAt && <span className="muted"> · réglé le {formatDateTime(s.updatedAt)}{s.updatedBy && ` par ${shortUser(s.updatedBy)}`}</span>}
            </p>
            {s.lastError && (
              <p className="small danger-text">
                Dernier envoi en échec le {formatDateTime(s.lastError.at)} : {s.lastError.message}
              </p>
            )}
            <div className="actions">
              <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => api.testTeams(), 'Message d’essai envoyé : vérifiez le canal.')}>Envoyer un message d’essai</button>
              <button className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>Changer de canal…</button>
              <button
                className="btn btn-danger-ghost btn-sm"
                disabled={busy}
                onClick={() => confirm('Déconnecter Teams ? Plus aucune notification ne sera envoyée.') && void run(() => api.saveTeamsSettings({ webhookUrl: '' }), 'Teams déconnecté.')}
              >
                Déconnecter
              </button>
            </div>
          </>
        )}
        {editing && (
          <>
            <ol className="small teams-steps">
              <li>Dans Teams, ouvrez le canal voulu, menu <strong>⋯</strong> du canal → <strong>Flux de travail</strong> (Workflows).</li>
              <li>
                Dans <strong>Rechercher des modèles</strong>, tapez <strong>webhook</strong> et choisissez <strong>« Envoyer des alertes webhook à un canal »</strong>{' '}
                (ou « Send webhook alerts from anyone to Teams »). Pas ceux « de personnes spécifiques » ni « de collaborateurs d’une organisation » : ils exigent
                une connexion Microsoft que Hobbit n’a pas.
              </li>
              <li>Donnez-lui un nom (« Hobbit »), vérifiez l’équipe et le canal, puis validez.</li>
              <li>Copiez l’adresse affichée à la fin (bouton de copie) et collez-la ci-dessous.</li>
            </ol>
            <label className="field">
              <span>Adresse du flux</span>
              <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…logic.azure.com/workflows/… ou https://…powerplatform.com/…" autoFocus />
            </label>
            {urlError && <p className="small danger-text">{urlError}</p>}
            <p className="muted small">Cette adresse permet à quiconque la connaît d’écrire dans le canal : elle n’est plus affichée une fois enregistrée.</p>
            <div className="actions mt">
              <button className="btn btn-primary btn-sm" disabled={busy || !url.trim() || !!urlError} onClick={() => void saveUrl()}>Connecter et envoyer un essai</button>
              {s.connected && <button className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setUrl(''); }}>Annuler</button>}
            </div>
          </>
        )}
      </section>
      <section className="card">
        <div className="card-head">
          <h2>Notifications envoyées</h2>
        </div>
        <div className="settings-list">
          {NOTIFICATION_EVENTS.map((e) => (
            <label key={e} className="check">
              <input type="checkbox" checked={s.events[e]} disabled={busy || !s.connected} onChange={(ev) => void toggle(e, ev.target.checked)} />{' '}
              <span>
                <strong>{NOTIFICATION_EVENT_LABELS[e].title}</strong> <span className="muted small">— {NOTIFICATION_EVENT_LABELS[e].hint}</span>
              </span>
            </label>
          ))}
        </div>
        {!s.connected && <p className="muted small mt">Connectez d’abord un canal.</p>}
      </section>
    </>
  );
}
