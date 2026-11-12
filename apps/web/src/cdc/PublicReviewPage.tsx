import { useEffect, useState } from 'react';
import { REVIEW_DECISION_LABELS, type PublicReviewDocument, type PublicReviewInfo, type ReviewDecision } from '@samm/shared';
import { publicApi } from '../api';
import { Brand } from '../components/Brand';
import { Spinner, formatDateTime } from '../components/ui';
import { MarkdownView } from '../projects/common';

/**
 * Page du lien de validation d'un cahier des charges (`/validation/<jeton>`), sans connexion au hub : la personne saisit
 * son adresse e-mail, lit le CDC (lecture seule) et répond « validé » ou « non validé », avec un commentaire.
 */
export function PublicReviewPage({ token }: { token: string }) {
  const [info, setInfo] = useState<PublicReviewInfo | null>(null);
  const [doc, setDoc] = useState<PublicReviewDocument | null>(null);
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answered, setAnswered] = useState<ReviewDecision | null>(null);

  useEffect(() => {
    document.title = 'Validation d’un cahier des charges — Hobbit';
    publicApi.review(token).then(setInfo, (e: Error) => setError((e as { status?: number }).status === 404 ? 'Ce lien n’est plus valable : la demande a peut-être été retirée.' : e.message));
  }, [token]);

  async function open() {
    setBusy(true);
    setError('');
    try {
      const d = await publicApi.openReview(token, email);
      setDoc(d);
      setComment(d.comment);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function answer(decision: ReviewDecision) {
    setBusy(true);
    setError('');
    try {
      const r = await publicApi.answerReview(token, { email, decision, comment });
      setDoc((d) => d && { ...d, decision: r.decision, comment: r.comment, answeredAt: r.answeredAt });
      setAnswered(decision);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pr-page">
      <header className="pr-head">
        <div className="pr-brand">
          <Brand />
        </div>
      </header>
      <main className="pr-main">
        {!info && !error && <Spinner />}
        {error && !doc && !info && <div className="pr-card"><p className="due-late">{error}</p></div>}
        {info && !doc && (
          <div className="pr-card pr-narrow">
            <h1>Validation d’un cahier des charges</h1>
            <p>
              <strong>{info.requestedByName}</strong> vous demande de valider <strong>« {info.cdcTitle} »</strong> (version {info.versionLabel}), le {formatDateTime(info.requestedAt)}.
            </p>
            <label className="field">
              <span>Votre adresse e-mail <span className="muted">({info.emailHint})</span></span>
              <input className="input" type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email.trim() && void open()} placeholder="prenom.nom@entreprise.fr" />
            </label>
            {error && <p className="small due-late">{error}</p>}
            <button className="btn btn-primary mt" disabled={busy || !email.trim()} onClick={() => void open()}>{busy && <Spinner small />} Ouvrir le cahier des charges</button>
          </div>
        )}
        {doc && (
          <>
            {answered && (
              <div className={`pr-card pr-thanks pr-thanks-${answered}`}>
                <strong>Merci, votre réponse est enregistrée : {REVIEW_DECISION_LABELS[answered].toLowerCase()}.</strong> {doc.requestedByName} la retrouve dans le hub. Vous pouvez encore la
                modifier ci-dessous.
              </div>
            )}
            <article className="pr-card">
              <p className="muted small">Demandé par {doc.requestedByName} · version {doc.versionLabel} · lecture seule</p>
              <h1>{doc.cdcTitle}</h1>
              {(doc.projet || doc.prestataire) && <p className="muted">{[doc.projet && `Projet : ${doc.projet}`, doc.prestataire && `Prestataire : ${doc.prestataire}`].filter(Boolean).join(' · ')}</p>}
              {doc.message && <blockquote className="pr-message">{doc.message}</blockquote>}
              {doc.sections.map((s, i) => (
                <section key={i} className="pr-section">
                  <h2>{s.title}</h2>
                  <MarkdownView markdown={s.markdown} />
                </section>
              ))}
            </article>
            <div className="pr-card pr-answer">
              <h2>Votre avis</h2>
              {doc.decision && !answered && (
                <p className="small">Votre réponse actuelle : <strong>{REVIEW_DECISION_LABELS[doc.decision]}</strong>{doc.answeredAt && ` (${formatDateTime(doc.answeredAt)})`}. Vous pouvez la modifier.</p>
              )}
              <label className="field">
                <span>Commentaire <span className="muted">(facultatif ; utile surtout si vous ne validez pas)</span></span>
                <textarea className="input" rows={4} maxLength={5000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Vos remarques, ce qui manque, ce qui est à corriger…" />
              </label>
              {error && <p className="small due-late">{error}</p>}
              <div className="actions mt">
                <span className="tb-flex" />
                <button className="btn btn-danger-ghost" disabled={busy} onClick={() => void answer('refuse')}>✗ Je ne valide pas</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => void answer('valide')}>{busy && <Spinner small />} ✓ Je valide</button>
              </div>
              <p className="muted small">Votre réponse n’est pas bloquante : elle est transmise au chargé de projet, qui décide de la suite.</p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
