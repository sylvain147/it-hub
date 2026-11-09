import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ASSISTANT_HISTORY_MAX, ASSISTANT_STARTERS, type AssistantAnswer, type AssistantMessage } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { MarkdownView } from '../projects/common';

/**
 * Assistant : un chat où l'on interroge l'IA sur les projets, les échéances, les tickets et sa to-do. La conversation
 * reste dans le navigateur (onglet en cours) ; chaque question est un appel IA, envoyé seulement au clic.
 */

interface ChatEntry extends AssistantMessage {
  /** Réponse : projets détaillés et relances proposées. */
  projects?: AssistantAnswer['projects'];
  followUps?: string[];
  error?: boolean;
}

const storageKey = (email: string) => `hobbit:assistant:${email}`;

function loadChat(email: string): ChatEntry[] {
  try {
    const raw = sessionStorage.getItem(storageKey(email));
    return raw ? (JSON.parse(raw) as ChatEntry[]) : [];
  } catch {
    return [];
  }
}

export function AssistantPage() {
  const { me } = useAuth();
  const [chat, setChat] = useState<ChatEntry[]>(() => loadChat(me.email));
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(me.email), JSON.stringify(chat.slice(-40)));
    } catch {
      /* stockage plein ou indisponible : la conversation reste en mémoire */
    }
  }, [chat, me.email]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [chat.length, busy]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    // Seuls les derniers échanges réussis repartent avec la question.
    const history = chat
      .filter((m) => !m.error)
      .slice(-ASSISTANT_HISTORY_MAX * 2)
      .map(({ role, content }) => ({ role, content }));
    setChat((c) => [...c, { role: 'user', content: q }]);
    setQuestion('');
    setBusy(true);
    try {
      const r = await api.askAssistant({ question: q, history });
      setChat((c) => [...c, { role: 'assistant', content: r.answer, projects: r.projects, followUps: r.followUps }]);
    } catch (e) {
      setChat((c) => [...c, { role: 'assistant', content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function reset() {
    if (chat.length && !confirm('Effacer la conversation ?')) return;
    setChat([]);
    inputRef.current?.focus();
  }

  const last = chat.at(-1);
  return (
    <div className="page assistant-page">
      <div className="page-head">
        <div>
          <h1>Assistant</h1>
          <p className="muted small">
            Posez vos questions sur les projets, les échéances, le sprint, vos tickets et votre <Link to="/todo">to-do</Link>. L’assistant répond à partir des données du hub ; il ne
            modifie rien. La conversation reste dans cet onglet.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={reset} disabled={busy || !chat.length}>Nouvelle conversation</button>
        </div>
      </div>

      <section className="card assistant-chat">
        {!chat.length && (
          <div className="assistant-empty">
            <p className="muted">Par exemple :</p>
            <div className="assistant-chips">
              {ASSISTANT_STARTERS.map((s) => (
                <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`assistant-msg ${m.role}${m.error ? ' error' : ''}`}>
            {m.role === 'user' ? <p>{m.content}</p> : m.error ? <p>⚠ {m.content}</p> : <MarkdownView markdown={m.content} />}
            {m.projects && m.projects.length > 0 && (
              <p className="muted small assistant-sources">
                Détail consulté : {m.projects.map((p, k) => <span key={p.id}>{k > 0 && ', '}<Link to={`/projets/${p.id}`}>{p.name}</Link></span>)}
              </p>
            )}
          </div>
        ))}
        {busy && <div className="assistant-msg assistant typing" aria-live="polite"><span /><span /><span /></div>}
        {!busy && last?.role === 'assistant' && !!last.followUps?.length && (
          <div className="assistant-chips">
            {last.followUps.map((s) => (
              <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </section>

      <div className="assistant-input">
        <textarea
          ref={inputRef}
          className="input"
          rows={2}
          autoFocus
          value={question}
          maxLength={2000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          placeholder="Votre question… (Entrée pour envoyer, Maj + Entrée pour aller à la ligne)"
          aria-label="Question"
        />
        <button className="btn btn-primary" disabled={busy || !question.trim()} onClick={() => void ask(question)}>Envoyer</button>
      </div>
      <p className="muted small">Chaque question est un appel à l’IA (modèle rapide, suivi dans la consommation IA). Vérifiez les points importants dans le hub.</p>
    </div>
  );
}
