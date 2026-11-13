import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ASSISTANT_ATTACHMENTS_CHARS, ASSISTANT_ATTACHMENTS_MAX, ASSISTANT_HISTORY_CHARS, ASSISTANT_HISTORY_MAX, ASSISTANT_QUESTION_MAX, ASSISTANT_STARTERS, type AssistantAnswer, type AssistantMessage } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { MarkdownView } from '../projects/common';
import { useProjectRefs } from '../tasks/tasks';
import { useAssistant } from '../theme';
import { ActionCard, type ChatAction } from './actions';
import { ACCEPT, prepareFile, questionWithTexts, type PendingFile, type SentFile } from './attachments';
import { toast } from '../components/ui';

/**
 * Gandalf, l'assistant (Saroumane sous le thème Mordor : `useAssistant`) : bouton volant en bas à droite, qui ouvre un chat où l'on interroge l'IA sur les projets,
 * les échéances, les tickets et sa to-do. La conversation reste dans le navigateur (onglet en cours) et continue
 * d'une page à l'autre ; chaque question est un appel IA, envoyé seulement au clic.
 *
 * On peut aussi lui coller un long texte (compte rendu, transcription, e-mail) : il propose alors les tickets, tâches
 * et jalons à créer, que l'on valide un par un (`actions.tsx`). Images (collées, glissées) et fichiers joints :
 * `attachments.ts` ; ils ne partent qu'avec la question où ils sont joints. Une autre page lui confie un texte par `openGandalf`.
 */

const OPEN_EVENT = 'hobbit:gandalf';

/** Ouvre Gandalf avec un texte prêt à envoyer (l'envoi reste un clic de l'utilisateur). */
export function openGandalf(text: string) {
  window.dispatchEvent(new CustomEvent<string>(OPEN_EVENT, { detail: text }));
}

/**
 * Bouton « Actions avec Gandalf » d'une note ou d'une entrée du journal : ouvre Gandalf avec le texte, prêt à envoyer,
 * pour qu'il propose les tickets, tâches et jalons à créer (rien n'est envoyé ni créé sans clic).
 */
export function GandalfActionsButton({ what, title, content, className = 'btn-icon', withLabel }: { what: string; title?: string; content: string; className?: string; withLabel?: boolean }) {
  const assistant = useAssistant();
  const intro = `Voici ${what}${title?.trim() ? ` « ${title.trim()} »` : ''}. Propose-moi les tickets, tâches et jalons à créer.\n\n`;
  const text = (intro + content.trim()).slice(0, ASSISTANT_QUESTION_MAX);
  return (
    <button className={className} disabled={!content.trim()} title={`${assistant.name} propose les tickets, tâches et jalons à créer à partir de ce texte ; vous validez chacun`} onClick={() => openGandalf(text)}>
      <img src={assistant.avatar} alt="" className="gandalf-mini" /> {withLabel && `Actions avec ${assistant.name}`}
    </button>
  );
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
  /** Pièces jointes d'une question (nom et vignette). */
  files?: SentFile[];
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
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [reading, setReading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
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

  async function addFiles(list: File[]) {
    if (!list.length) return;
    const room = ASSISTANT_ATTACHMENTS_MAX - files.length;
    if (list.length > room) toast(`${ASSISTANT_ATTACHMENTS_MAX} pièces jointes au plus par message.`, 'error');
    setReading((n) => n + Math.min(room, list.length));
    for (const f of list.slice(0, Math.max(0, room))) {
      try {
        const p = await prepareFile(f);
        setFiles((xs) => [...xs, p]);
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setReading((n) => n - 1);
      }
    }
    inputRef.current?.focus();
  }

  async function ask(text: string, withFiles: PendingFile[] = []) {
    // Sans texte, des pièces jointes seules : Gandalf les analyse.
    const typed = text.trim() || (withFiles.length ? 'Voici les pièces jointes : analyse-les.' : '');
    const q = questionWithTexts(typed, withFiles);
    if (!q || busy) return;
    const attachments = withFiles.flatMap((f) => (f.kind === 'binary' ? [f.attachment] : []));
    if (q.length > ASSISTANT_QUESTION_MAX) return toast(`Texte trop long avec les pièces jointes (${ASSISTANT_QUESTION_MAX.toLocaleString('fr-FR')} caractères au plus).`, 'error');
    if (attachments.reduce((n, a) => n + a.data.length, 0) > ASSISTANT_ATTACHMENTS_CHARS) return toast('Pièces jointes trop lourdes (3 Mo au total au plus) : retirez-en une.', 'error');
    // Seuls les derniers échanges réussis repartent avec la question.
    const history = chat
      .filter((m) => !m.error)
      .slice(-ASSISTANT_HISTORY_MAX * 2)
      .map(({ role, content }) => ({ role, content: content.length > ASSISTANT_HISTORY_CHARS ? `${content.slice(0, ASSISTANT_HISTORY_CHARS)}…` : content }));
    const sent = withFiles.map((f) => ({ name: f.name, thumb: f.kind === 'binary' ? f.thumb : undefined }));
    setChat((c) => [...c, { role: 'user', content: q, ...(sent.length ? { files: sent } : {}) }]);
    setQuestion('');
    if (withFiles.length) setFiles([]);
    setBusy(true);
    try {
      const r = await api.askAssistant({ question: q, history, attachments });
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
        <div
          className={`gandalf-pop${dragging ? ' dragging' : ''}`}
          role="dialog"
          aria-label={`${name}, l’assistant`}
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
          onDrop={(e) => {
            if (!e.dataTransfer.files.length) return;
            e.preventDefault();
            setDragging(false);
            void addFiles([...e.dataTransfer.files]);
          }}
        >
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
                  Demandez-lui aussi de créer un ticket, une tâche ou un jalon (« Crée-moi un ticket de dev sur La Poste, c’est important »), ou collez-lui un compte rendu,
                  une transcription de réunion ou un e-mail : il propose ce qu’il faut créer, et rien n’est créé sans votre clic.
                </p>
                <p className="small">Collez une capture d’écran (Ctrl+V) ou joignez un fichier (📎 : image, PDF, Word, Excel, texte) pour qu’il l’analyse.</p>
                <div className="assistant-chips">
                  {ASSISTANT_STARTERS.map((s) => (
                    <button key={s} className="chip" onClick={() => void ask(s)}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`assistant-msg ${m.role}${m.error ? ' error' : ''}`}>
                {m.files && m.files.length > 0 && (
                  <div className="gandalf-files">
                    {m.files.map((f, k) => (f.thumb ? <img key={k} src={f.thumb} alt={f.name} title={f.name} /> : <span key={k} className="gandalf-file">📄 {f.name}</span>))}
                  </div>
                )}
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

          {(files.length > 0 || reading > 0) && (
            <div className="gandalf-files gandalf-pending">
              {files.map((f, k) => (
                <span key={k} className="gandalf-file" title={f.name}>
                  {f.kind === 'binary' && f.thumb ? <img src={f.thumb} alt="" /> : '📄'} <span className="gandalf-file-name">{f.name}</span>
                  <button className="gandalf-file-remove" onClick={() => setFiles((xs) => xs.filter((_, j) => j !== k))} aria-label={`Retirer ${f.name}`}>×</button>
                </span>
              ))}
              {reading > 0 && <span className="gandalf-file muted">Lecture…</span>}
            </div>
          )}
          <div className="gandalf-input">
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              accept={ACCEPT}
              onChange={(e) => {
                void addFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            <button className="btn btn-ghost gandalf-attach" onClick={() => fileRef.current?.click()} disabled={busy || files.length >= ASSISTANT_ATTACHMENTS_MAX} title="Joindre un fichier (image, PDF, Word, Excel, texte)" aria-label="Joindre un fichier">📎</button>
            <textarea
              ref={inputRef}
              className="input"
              rows={2}
              value={question}
              maxLength={ASSISTANT_QUESTION_MAX}
              onChange={(e) => setQuestion(e.target.value)}
              onPaste={(e) => {
                // Image seule (capture d'écran) : jointe. Une copie Excel ou Word porte aussi une image, mais d'abord du texte : il est collé.
                const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
                if (!images.length || e.clipboardData.getData('text/plain').trim()) return;
                e.preventDefault();
                void addFiles(images);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (!reading) void ask(question, files);
                }
              }}
              placeholder="Une question, une demande ou un compte rendu… (Entrée pour envoyer)"
              aria-label="Question"
            />
            <button className="btn btn-primary" disabled={busy || reading > 0 || (!question.trim() && !files.length)} onClick={() => void ask(question, files)}>Envoyer</button>
          </div>
          <p className="muted gandalf-foot">Chaque question est un appel à l’IA (suivi dans la consommation IA), pièces jointes comprises. Vérifiez les points importants dans le hub.</p>
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
