import { useState } from 'react';
import { Link } from 'react-router';
import { FEEDBACK_KIND_ICONS, FEEDBACK_KIND_LABELS, type Feedback } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner, formatDateTime, shortUser, toast } from '../components/ui';

type Filter = 'nouveau' | 'traite' | 'tous';

/** Retours des utilisateurs sur l'application (rôles habilités). */
export function FeedbackPage() {
  const { me } = useAuth();
  const data = useLoad(() => api.listFeedback(), []);
  const [filter, setFilter] = useState<Filter>('nouveau');

  if (!me.permissions.manageFeedback) return <div className="page"><ErrorBox error="Votre rôle ne permet pas de lire les retours." /></div>;

  const all = data.data ?? [];
  const shown = all.filter((f) => filter === 'tous' || f.status === filter);
  const count = (s: Filter) => (s === 'tous' ? all.length : all.filter((f) => f.status === s).length);

  async function act(fn: () => Promise<unknown>, msg: string) {
    try {
      await fn();
      toast(msg);
      await data.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Retours</h1>
          <p className="muted small">Bugs, idées et remarques envoyés par l’équipe avec le bouton « Faire un retour ».</p>
        </div>
        <div className="seg">
          {(['nouveau', 'traite', 'tous'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'nouveau' ? 'À traiter' : f === 'traite' ? 'Traités' : 'Tous'} ({count(f)})
            </button>
          ))}
        </div>
      </div>
      <ErrorBox error={data.error} />
      {data.loading && !data.data && <Spinner />}
      {data.data && !shown.length && <EmptyState>{filter === 'nouveau' ? 'Aucun retour à traiter. 🎉' : 'Aucun retour.'}</EmptyState>}
      {shown.map((f) => (
        <FeedbackCard
          key={f.id}
          f={f}
          onTreat={(note) => void act(() => api.updateFeedback(f.id, { status: 'traite', note }), 'Retour marqué comme traité.')}
          onReopen={() => void act(() => api.updateFeedback(f.id, { status: 'nouveau', note: f.note }), 'Retour rouvert.')}
          onDelete={() => confirm('Supprimer ce retour ?') && void act(() => api.deleteFeedback(f.id), 'Retour supprimé.')}
        />
      ))}
    </div>
  );
}

function FeedbackCard({ f, onTreat, onReopen, onDelete }: { f: Feedback; onTreat: (note: string) => void; onReopen: () => void; onDelete: () => void }) {
  const [note, setNote] = useState(f.note);
  const [noting, setNoting] = useState(false);
  return (
    <section className={f.status === 'traite' ? 'card feedback-card treated' : 'card feedback-card'}>
      <div className="card-head">
        <div>
          <span className={f.kind === 'bug' ? 'badge badge-danger' : f.kind === 'idee' ? 'badge badge-ok' : 'badge'}>
            {FEEDBACK_KIND_ICONS[f.kind]} {FEEDBACK_KIND_LABELS[f.kind]}
          </span>{' '}
          <strong>{f.authorName || shortUser(f.createdBy)}</strong> <span className="muted small">le {formatDateTime(f.createdAt)}</span>
        </div>
        <div className="row-actions">
          {f.status === 'nouveau' ? (
            noting ? null : (
              <>
                <button className="btn btn-sm" onClick={() => setNoting(true)}>Ajouter une note…</button>
                <button className="btn btn-primary btn-sm" onClick={() => onTreat(note)}>✓ Traité</button>
              </>
            )
          ) : (
            <button className="btn btn-sm" onClick={onReopen}>Rouvrir</button>
          )}
          <button className="btn-icon danger" title="Supprimer" onClick={onDelete}>🗑</button>
        </div>
      </div>
      <p className="feedback-message">{f.message}</p>
      <div className="muted small">
        {f.page && <>Page : <Link to={f.page}>{f.page}</Link></>}
        {f.client && <span title={f.client}> · {f.client.split(' · ').at(-1)}</span>}
      </div>
      {noting && f.status === 'nouveau' && (
        <div className="mt">
          <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Réponse ou suite donnée (facultatif)" autoFocus />
          <div className="actions mt">
            <button className="btn btn-primary btn-sm" onClick={() => onTreat(note)}>✓ Marquer comme traité</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setNoting(false)}>Annuler</button>
          </div>
        </div>
      )}
      {f.status === 'traite' && (
        <p className="small mt">
          ✓ Traité{f.treatedAt && ` le ${formatDateTime(f.treatedAt)}`}{f.treatedBy && ` par ${shortUser(f.treatedBy)}`}
          {f.note && <> — {f.note}</>}
        </p>
      )}
    </section>
  );
}
