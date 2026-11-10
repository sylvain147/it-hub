import { useEffect } from 'react';
import notes from 'virtual:patch-notes';
import { EmptyState, formatDateTime } from '../components/ui';

const SEEN_KEY = 'hub.patchNote.vu';

/** Une mise à jour est parue depuis la dernière visite du patch note sur ce poste. */
export function hasUnreadPatchNote(): boolean {
  const last = notes[0]?.id;
  return !!last && localStorage.getItem(SEEN_KEY) !== last;
}

/**
 * Patch note : les mises à jour du hub, de la plus récente à la plus ancienne. Construit automatiquement à chaque
 * déploiement à partir de l'historique du code (une entrée par mise à jour, avec le détail de ses modifications).
 */
export function PatchNotePage() {
  useEffect(() => {
    if (notes[0]) localStorage.setItem(SEEN_KEY, notes[0].id);
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Patch note</h1>
          <p className="muted small">Les mises à jour de Hobbit, de la plus récente à la plus ancienne. Une entrée s’ajoute automatiquement à chaque mise à jour du hub.</p>
        </div>
      </div>
      {!notes.length && <EmptyState>Aucune mise à jour à afficher : l’historique du code n’était pas disponible lors de la construction du hub.</EmptyState>}
      {notes.map((n) => {
        // Le détail répète le titre quand la mise à jour ne compte qu'une modification.
        const changes = n.changes.length === 1 && n.changes[0]!.title === n.title ? [{ title: '', details: n.changes[0]!.details }] : n.changes;
        return (
          <section key={n.id} className="card patch-note">
            <div className="patch-note-head">
              <h2>{n.title}</h2>
              <span className="muted small nowrap">
                {formatDateTime(n.date)}
                {n.pr !== null && <> · n° {n.pr}</>}
              </span>
            </div>
            {changes.length > 0 && (
              <ul className="patch-note-changes">
                {changes.map((c, i) =>
                  c.title ? (
                    <li key={i}>
                      {c.details ? (
                        <details>
                          <summary>{c.title}</summary>
                          <p className="muted small patch-note-details">{c.details}</p>
                        </details>
                      ) : (
                        c.title
                      )}
                    </li>
                  ) : (
                    c.details && <li key={i} className="patch-note-solo"><p className="muted small patch-note-details">{c.details}</p></li>
                  ),
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
