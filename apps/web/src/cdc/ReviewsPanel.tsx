import { useState } from 'react';
import { REVIEW_DECISION_LABELS, type CdcDetail, type CdcReview, type RequestCdcReviewResult } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDateTime, toast } from '../components/ui';
import { UserChoices } from '../users/context';

/** Adresses saisies à la main (séparées par des virgules, des points-virgules ou des espaces). */
const parseEmails = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/**
 * Onglet « Validations » d'un CDC : demander à des personnes (du hub ou extérieures) de valider la version courante.
 * Chacune reçoit un e-mail avec un lien personnel ; ses réponses (validé ou non, commentaire) arrivent ici. Une non-validation
 * ne bloque rien.
 */
export function ReviewsPanel({ detail }: { detail: CdcDetail }) {
  const { data, loading, reload } = useLoad(() => api.cdcReviews(detail.id), [detail.id]);
  const [asking, setAsking] = useState(false);
  const [sent, setSent] = useState<RequestCdcReviewResult | null>(null);
  const reviews = data ?? [];
  const answered = reviews.filter((r) => r.decision);

  async function remove(r: CdcReview) {
    if (!confirm(`Retirer la demande envoyée à ${r.name || r.email} ? Son lien ne fonctionnera plus.`)) return;
    try {
      await api.deleteCdcReview(detail.id, r.id);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="panel-body">
      <p className="muted small">
        Faites valider le cahier des charges par d’autres personnes, du hub ou non : elles reçoivent un lien par e-mail, lisent le document sans pouvoir le modifier et
        répondent « validé » ou « non validé », avec un commentaire. Une non-validation n’est pas bloquante.
      </p>
      <button className="btn btn-primary btn-sm" onClick={() => setAsking(true)}>✉️ Demander une validation</button>
      {reviews.length > 0 && (
        <p className="small mt">
          <strong>{answered.filter((r) => r.decision === 'valide').length}</strong> validé · <strong>{answered.filter((r) => r.decision === 'refuse').length}</strong> non validé ·{' '}
          <strong>{reviews.length - answered.length}</strong> en attente
        </p>
      )}
      {loading && !data ? (
        <Spinner />
      ) : !reviews.length ? (
        <EmptyState>Aucune demande de validation.</EmptyState>
      ) : (
        <ul className="list-plain review-list">
          {reviews.map((r) => (
            <li key={r.id} className={`review review-${r.decision ?? 'attente'}`}>
              <div className="review-head">
                <strong>{r.name || r.email}</strong>
                <span className={`badge review-badge-${r.decision ?? 'attente'}`}>{r.decision ? REVIEW_DECISION_LABELS[r.decision] : 'En attente'}</span>
              </div>
              <div className="muted small">
                {r.name && <>{r.email} · </>}version {r.versionLabel}
                {r.versionSeq !== detail.currentVersion.seq && ' (le CDC a changé depuis)'} · demandé le {formatDateTime(r.requestedAt)}
              </div>
              {r.comment && <p className="review-comment">« {r.comment} »</p>}
              {r.answeredAt && <div className="muted small">Réponse du {formatDateTime(r.answeredAt)}</div>}
              {r.sendError && <div className="small due-late">{r.sendError}</div>}
              <button className="btn-link small" onClick={() => void remove(r)}>Retirer la demande</button>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <AskDialog
          detail={detail}
          onClose={() => setAsking(false)}
          onSent={async (r) => {
            setAsking(false);
            setSent(r);
            await reload();
          }}
        />
      )}
      {sent && <SentDialog result={sent} onClose={() => setSent(null)} />}
    </div>
  );
}

function AskDialog({ detail, onClose, onSent }: { detail: CdcDetail; onClose: () => void; onSent: (r: RequestCdcReviewResult) => Promise<void> }) {
  const [hub, setHub] = useState<string[]>([]);
  const [others, setOthers] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const external = parseEmails(others);
  const invalid = external.filter((e) => !isEmail(e));
  const emails = [...new Set([...hub, ...external])];

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await onSent(await api.requestCdcReview(detail.id, { emails, message }));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Demander une validation"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !emails.length || invalid.length > 0} onClick={() => void send()}>
            {busy && <Spinner small />} Envoyer {emails.length > 1 ? `les ${emails.length} demandes` : 'la demande'}
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <p className="muted small">
        Version soumise : <strong>{detail.currentVersion.label}</strong>. Enregistrez d’abord vos dernières modifications : c’est cette version que les personnes liront.
      </p>
      <div className="field">
        <span>Personnes du hub</span>
        <UserChoices value={hub} onChange={setHub} placeholder="Choisir des utilisateurs du hub…" />
      </div>
      <label className="field mt">
        <span>Autres personnes <span className="muted">(adresses e-mail, séparées par des virgules)</span></span>
        <textarea className="input" rows={2} value={others} onChange={(e) => setOthers(e.target.value)} placeholder="ex. jean.dupont@prestataire.fr, direction.logistique@entreprise.fr" />
        {invalid.length > 0 && <span className="small due-late">Adresse{invalid.length > 1 ? 's' : ''} invalide{invalid.length > 1 ? 's' : ''} : {invalid.join(', ')}</span>}
      </label>
      <label className="field mt">
        <span>Message <span className="muted">(facultatif, repris dans l’e-mail)</span></span>
        <textarea className="input" rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="ex. Merci de relire le périmètre et les délais avant vendredi." />
      </label>
    </Modal>
  );
}

/** Après l'envoi : chaque lien, à copier (utile si l'e-mail n'est pas parti, ou pour le renvoyer soi-même). */
function SentDialog({ result, onClose }: { result: RequestCdcReviewResult; onClose: () => void }) {
  const failed = result.reviews.filter((r) => !r.sentAt);
  return (
    <Modal title="Demandes de validation" onClose={onClose} footer={<><span className="tb-flex" /><button className="btn btn-primary" onClick={onClose}>Fermer</button></>}>
      <p>
        {result.reviews.length - failed.length > 0 && <>✉️ {result.reviews.length - failed.length} e-mail{result.reviews.length - failed.length > 1 ? 's' : ''} envoyé{result.reviews.length - failed.length > 1 ? 's' : ''}. </>}
        {failed.length > 0 && <>Pour {failed.length > 1 ? `${failed.length} personnes` : 'une personne'}, l’e-mail n’est pas parti : copiez son lien et transmettez-le vous-même.</>}
      </p>
      <ul className="list-plain review-links">
        {result.reviews.map((r) => (
          <li key={r.id}>
            <span>
              <strong>{r.name || r.email}</strong> {r.sentAt ? <span className="badge badge-ok">e-mail envoyé</span> : <span className="badge badge-warn">à transmettre</span>}
            </span>
            <span className="review-link-row">
              <input className="input input-sm" readOnly value={r.link} onFocus={(e) => e.target.select()} aria-label={`Lien pour ${r.email}`} />
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(r.link).then(() => toast('Lien copié.'))}>Copier</button>
            </span>
          </li>
        ))}
      </ul>
      <p className="muted small">Chaque lien est personnel : la personne doit saisir son adresse e-mail pour ouvrir le cahier des charges. Il n’est montré qu’ici, une seule fois.</p>
    </Modal>
  );
}
