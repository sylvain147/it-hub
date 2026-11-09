import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

/**
 * Transcription d'une réunion en direct, par la reconnaissance vocale du navigateur (Chrome, Edge) : seul le texte
 * est conservé, le son n'est jamais enregistré. Le micro reste actif d'une page à l'autre du hub (fournisseur
 * global) ; le texte est gardé sur le poste (brouillon) jusqu'à ce qu'il soit analysé, enregistré ou effacé.
 */

const DRAFT_KEY = 'hub.reunion.brouillon';

/** API Web Speech (préfixée sous Chrome), absente des types du DOM. */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface MeetingDraft {
  title: string;
  projectId: string;
  /** Date de la réunion (AAAA-MM-JJ). */
  date: string;
  text: string;
}

const emptyDraft = (): MeetingDraft => ({ title: '', projectId: '', date: new Date().toISOString().slice(0, 10), text: '' });

function loadDraft(): MeetingDraft {
  try {
    return { ...emptyDraft(), ...(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<MeetingDraft>) };
  } catch {
    return emptyDraft();
  }
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Accès au micro refusé : autorisez le micro pour ce site (icône à gauche de l’adresse), puis recommencez.',
  'service-not-allowed': 'La reconnaissance vocale est bloquée par le navigateur.',
  'audio-capture': 'Aucun micro détecté.',
  network: 'La reconnaissance vocale du navigateur ne répond pas (réseau). La transcription reprendra dès que possible.',
};

interface RecorderCtx {
  supported: boolean;
  recording: boolean;
  /** Secondes d'écoute cumulées. */
  elapsed: number;
  /** Phrase en cours de reconnaissance (pas encore définitive). */
  interim: string;
  error: string | null;
  draft: MeetingDraft;
  setDraft: (patch: Partial<MeetingDraft>) => void;
  start: () => void;
  stop: () => void;
  clear: () => void;
}

const Ctx = createContext<RecorderCtx | null>(null);

export function useMeetingRecorder(): RecorderCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('MeetingRecorderProvider manquant');
  return c;
}

const hhmm = () => new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export function MeetingRecorderProvider({ children }: { children: ReactNode }) {
  const Ctor = useMemo(recognitionCtor, []);
  const [draft, setDraftState] = useState<MeetingDraft>(loadDraft);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const wanted = useRef(false);
  /** Heure du dernier horodatage inséré : un repère par minute au plus. */
  const lastStamp = useRef('');

  const setDraft = useCallback((patch: Partial<MeetingDraft>) => setDraftState((d) => ({ ...d, ...patch })), []);
  useEffect(() => localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)), [draft]);

  const append = useCallback((phrase: string) => {
    const p = phrase.trim();
    if (!p) return;
    const t = hhmm();
    const stamp = t !== lastStamp.current;
    lastStamp.current = t;
    const sentence = p.charAt(0).toUpperCase() + p.slice(1);
    setDraftState((d) => ({ ...d, text: `${d.text}${d.text && !d.text.endsWith('\n') ? (stamp ? '\n' : ' ') : ''}${stamp ? `[${t}] ` : ''}${sentence}` }));
  }, []);

  const start = useCallback(() => {
    if (!Ctor || wanted.current) return;
    setError(null);
    wanted.current = true;
    const r = new Ctor();
    r.lang = 'fr-FR';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) append(res[0].transcript);
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(ERRORS[e.error] ?? `Reconnaissance vocale interrompue (${e.error}).`);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') wanted.current = false;
    };
    // Le navigateur coupe l'écoute après un silence ou au bout de quelques minutes : on relance tant qu'on n'a pas arrêté.
    r.onend = () => {
      setInterim('');
      if (wanted.current) {
        setTimeout(() => {
          if (!wanted.current) return;
          try {
            r.start();
          } catch {
            /* déjà relancée */
          }
        }, 250);
      } else setRecording(false);
    };
    rec.current = r;
    r.start();
    setRecording(true);
  }, [Ctor, append]);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
    setRecording(false);
  }, []);

  const clear = useCallback(() => {
    setDraftState(emptyDraft());
    setElapsed(0);
    lastStamp.current = '';
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    // Fermer l'onglet arrêterait la transcription : on prévient.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(t);
      window.removeEventListener('beforeunload', warn);
    };
  }, [recording]);

  const value = useMemo<RecorderCtx>(
    () => ({ supported: !!Ctor, recording, elapsed, interim, error, draft, setDraft, start, stop, clear }),
    [Ctor, recording, elapsed, interim, error, draft, setDraft, start, stop, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Pastille « transcription en cours » sur les autres pages du hub. */
export function RecordingPill() {
  const { recording, elapsed } = useMeetingRecorder();
  const { pathname } = useLocation();
  if (!recording || pathname === '/reunion') return null;
  return (
    <Link to="/reunion" className="rec-pill" title="Revenir à la transcription">
      <span className="rec-dot" /> Transcription en cours · {formatElapsed(elapsed)}
    </Link>
  );
}
