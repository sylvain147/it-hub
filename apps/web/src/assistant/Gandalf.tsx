import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ASSISTANT_HISTORY_CHARS, ASSISTANT_HISTORY_MAX, ASSISTANT_QUESTION_MAX, ASSISTANT_STARTERS, type AssistantAnswer, type AssistantMessage } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { MarkdownView } from '../projects/common';
import { useProjectRefs } from '../tasks/tasks';
import { useAssistant } from '../theme';
import { ActionCard, type ChatAction } from './actions';

/**
 * Gandalf, l'assistant (Saroumane sous le thème Mordor : `useAssistant`) : bouton volant en bas à droite, qui ouvre un chat où l'on interroge l'IA sur les projets,
 * les échéances, les tickets et sa to-do. La conversation reste dans le navigateur (onglet en cours) et continue
 * d'une page à l'autre ; chaque question est un appel IA, envoyé seulement au clic.
 *
 * On peut aussi lui coller un long texte (compte rendu, transcription, e-mail) : il propose alors les tickets, tâches
 * et jalons à créer, que l'on valide un par un (`actions.tsx`). Une autre page lui confie un texte par `openGandalf`.
 */

const OPEN_EVENT = 'hobbit:gandalf';

/** Ouvre Gandalf avec un texte prêt à envoyer (l'envoi reste un clic de l'utilisateur). */
export function openGandalf(text: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: text }));
}

/** Au-delà, un message de l'utilisateur s'affiche replié. */
const FOLD_CHARS = 600;

interface ChatEntry extends AssistantMessage {
  /** Réponse : projets détaillés et relances proposées. */
  projects?: AssistantAnswer['projects'];
  followUps?: string[];
  /** Propositions d'actions, avec leur état (créée, ignorée). */
  actions?: ChatAction[];
  error?: boolean;
}

const storageKey = (email: string) => `hobbit:assistant:${email}`;
/** Sur petit écran, le chat couvre la page : il se referme quand on suit un lien. */
const NARROW = '(max-width: 640px)';

function loadChat(email: string): ChatEntry[] {
  try {
    const raw = sessionStorage.getItem(storageKey(email));
    return raw ? (JSON.parse(raw) as ChatEntry[]) : [];
  } catch {
    return [];
  }
}

export function Gandalf() {
  const { me } = useAuth();
  const { name, avatar } = useAssistant();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<ChatEntry[]>(() => loadChat(me.email));
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Projets proposés pour le rattachement des actions, chargés à l'ouverture.
  const projects = useProjectRefs(open);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(me.email), JSON.stringify(chat.slice(-40)));
    } catch {
      /* stockage plein ou indisponible : la conversation reste en mémoire */
    }
  }, [chat, me.email]);
  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [open, chat.length, busy]);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (window.matchMedia(NARROW).matches) setOpen(false);
  }, [pathname]);
  useEffect(() => {
    const onOpen = (e: Event) => {
      setQuestion((e as CustomEvent<string>).detail.slice(0, ASSISTANT_QUESTION_MAX));
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    // Seuls les derniers échanges réussis repartent avec la question.
    const history = chat
      .filter((m) => !m.error)
      .slice(-ASSISTANT_HISTORY_MAX * 2)
      .map(({ role, content }) => ({ role, content: content.length > ASSISTANT_HISTORY_CHARS ? `${content.slice(0, ASSISTANT_HISTORY_CHARS)}…` : content }));
    setChat((c) => [...c, { role: 'user', content: q }]);
    setQuestion('');
    setBusy(true);
    try {
      const r = await api.askAssistant({ question: q, history });
      setChat((c) => [...c, { role: 'assistant', content: r.answer, projects: r.projects, followUps: r.followUps, actions: r.actions }]);
    } catch (e) {
      setChat((c) => [...c, { role: 'assistant', content: (e as Error).message, error: true }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function updateAction(msg: number, i: number, a: ChatAction) {
    setChat((c) => c.map((m, k) => (k === msg && m.actions ? { ...m, actions: m.actions.map((x, j) => (j === i ? a : x)) } : m)));
  }

  function reset() {
    if (chat.length && !confirm('Effacer la conversation ?')) return;
    setChat([]);
    inputRef.current?.focus();
  }

  const last = chat.at(-1);
  return (
    <>
      <button
        className={open ? 'gandalf-fab open' : 'gandalf-fab'}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? `Fermer ${name}` : `Demander à ${name}`}
      >
        <img src={avatar} alt={name} />
        {busy && !open && <span className="gandalf-fab-busy" aria-label={`${name} réfléchit`} />}
      </button>
      {open && (
        <div className="gandalf-pop" role="dialog" aria-label={`${name}, l’assistant`}>
          <div className="gandalf-head">
            <img src={avatar} alt="" />
            <div className="gandalf-title">
              <strong>{name}</strong>
              <span className="small">L’assistant du hub</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={reset} disabled={busy || !chat.length} title="Nouvelle conversation">Effacer</button>
            <button className="gandalf-close" onClick={() => setOpen(false)} aria-label="Fermer">×</button>
          </div>

          <div className="gandalf-body">
            {!chat.length && (
              <div className="assistant-empty">
                <p className="small">
                  Posez vos questions sur les projets, les échéances, le sprint, vos tickets et votre <Link to="/todo">to-do</Link>. {name} répond à partir des données du hub.
                </p>
                <p className="small">
                  Collez-lui aussi un compte rendu, une transcription de réunion ou un e-mail : il propose les tickets, tâches et jalons à créer, et rien n’est créé sans votre clic.
                </p>
                <div className="assistant-chips">
                  {ASSISTANT_STARTERS.map((s) => (
                    <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role}${m.error ? ' error' : ''}`}>
                {m.role === 'user' ? <UserText text={m.content} /> : m.error ? <p>⚠ {m.content}</p> : <MarkdownView markdown={m.content} />}
                {m.actions && m.actions.length > 0 && (
                  <div className="gandalf-actions">
                    {m.actions.map((a, k) => (
                      <ActionCard key={k} action={a} projects={projects} onChange={(x) => updateAction(i, k, x)} />
                    ))}
                  </div>
                )}
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
          </div>

          <div className="gandalf-input">
            <textarea
              ref={inputRef}
              className="input"
              rows={2}
              value={question}
              maxLength={ASSISTANT_QUESTION_MAX}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void ask(question);
                }
              }}
              placeholder="Votre question, ou un compte rendu à analyser… (Entrée pour envoyer)"
              aria-label="Question"
            />
            <button className="btn btn-primary" disabled={busy || !question.trim()} onClick={() => void ask(question)}>Envoyer</button>
          </div>
          <p className="muted gandalf-foot">Chaque question est un appel à l’IA (suivi dans la consommation IA). Vérifiez les points importants dans le hub.</p>
        </div>
      )}
    </>
  );
}

/** Message de l'utilisateur ; un long texte collé s'affiche replié. */
function UserText({ text }: { text: string }) {
  const [unfolded, setUnfolded] = useState(false);
  if (text.length <= FOLD_CHARS) return <p>{text}</p>;
  return (
    <>
      <p>{unfolded ? text : `${text.slice(0, FOLD_CHARS)}…`}</p>
      <button className="btn-link small" onClick={() => setUnfolded(!unfolded)}>
        {unfolded ? 'Replier' : `Afficher tout (${text.length.toLocaleString('fr-FR')} caractères)`}
      </button>
    </>
  );
}
