import { useState } from 'react';
import { useLocation } from 'react-router';
import { FEEDBACK_KINDS, FEEDBACK_KIND_ICONS, FEEDBACK_KIND_LABELS, type FeedbackKind } from '@samm/shared';
import { api } from '../api';
import { ErrorBox, Modal, Spinner, toast } from '../components/ui';

/** « Faire un retour » (menu de l'utilisateur, en bas du menu latéral) : bug, idée ou remarque, avec la page d'origine. */
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const location = useLocation();
  const [kind, setKind] = useState<FeedbackKind>('remarque');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const page = `${location.pathname}${location.search}`;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.sendFeedback({ kind, message, page, client: `${navigator.userAgent.slice(0, 400)} · ${window.innerWidth}×${window.innerHeight}` });
      toast('Merci pour votre retour !');
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Faire un retour sur l’application"
      onClose={onClose}
      footer={
        <>
          <span className="tb-flex" />
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || message.trim().length < 3} onClick={() => void send()}>
            {busy && <Spinner small />} Envoyer
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="seg mb">
        {FEEDBACK_KINDS.map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {FEEDBACK_KIND_ICONS[k]} {FEEDBACK_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{kind === 'bug' ? 'Que s’est-il passé ? Qu’attendiez-vous ?' : kind === 'idee' ? 'Votre idée' : 'Votre remarque'}</span>
        <textarea
          className="input"
          rows={6}
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && message.trim().length >= 3 && void send()}
        />
      </label>
      <p className="muted small">La page en cours ({page}) et votre nom sont joints au retour.</p>
    </Modal>
  );
}
