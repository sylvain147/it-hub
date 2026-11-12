import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ASSISTANT_QUESTION_MAX, MAX_PROJECT_TRANSCRIPT_CHARS } from '@samm/shared';
import { api } from '../api';
import { EmptyState, ErrorBox, Spinner, toast } from '../components/ui';
import { ProjectSelect, useProjectRefs } from '../tasks/tasks';
import { formatElapsed, useMeetingRecorder } from './recorder';
import { openGandalf } from '../assistant/Gandalf';
import { useAssistant } from '../theme';
import { withAiRecap } from '../assistant/AiRecap';

/** Taille maximale d'une note personnelle. */
const MAX_NOTE_CHARS = 50_000;

/**
 * Transcrire une réunion, depuis la page Notes : on lance l'écoute au début de la réunion (Teams, Zoom… dans une autre
 * application), le texte s'écrit au fil de l'eau ; à la fin, on la garde comme note, l'assistant en fait le compte rendu
 * dans le journal du projet (avec les tickets, jalons et risques à valider), ou Gandalf propose les actions.
 * `projectId` (lien depuis un projet) présélectionne le projet, sauf pendant une transcription déjà commencée.
 */
export function MeetingPanel({ projectId, onClose, onNoteSaved }: { projectId?: string; onClose: () => void; onNoteSaved: () => Promise<void> | void }) {
  const r = useMeetingRecorder();
  const { draft, setDraft } = r;
  const navigate = useNavigate();
  const projects = useProjectRefs();
  const [busy, setBusy] = useState<'ia' | 'note' | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const assistant = useAssistant();

  useEffect(() => {
    if (projectId && !r.recording && !draft.text.trim()) setDraft({ projectId });
    // Seulement à l'ouverture du panneau.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Le texte défile avec la transcription, sauf si l'on est remonté le relire.
  useEffect(() => {
    const el = textRef.current;
    if (el && r.recording && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [draft.text, r.recording]);

  const words = draft.text.trim() ? draft.text.trim().split(/\s+/).length : 0;
  const tooLong = draft.text.length > MAX_PROJECT_TRANSCRIPT_CHARS;
  // Gandalf : propositions d'actions sur tous les projets, sans compte rendu dans le journal.
  const gandalfIntro = 'Voici la transcription d’une réunion. Propose-moi les tickets, tâches et jalons à créer.\n\n';
  const tooLongForGandalf = gandalfIntro.length + draft.text.length > ASSISTANT_QUESTION_MAX;

  async function analyse() {
    if (!draft.projectId) return;
    r.stop();
    setBusy('ia');
    try {
      const started = await withAiRecap(() => api.digestMeeting(draft.projectId, { title: draft.title, date: draft.date, text: draft.text }));
      if (!started) return setBusy(null);
      toast('Analyse lancée : le compte rendu arrive dans le journal du projet.', 'info');
      const id = draft.projectId;
      r.clear();
      navigate(`/projets/${id}?onglet=journal`);
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(null);
    }
  }

  async function saveNote() {
    r.stop();
    setBusy('note');
    try {
      const title = draft.title || `Réunion du ${new Date(draft.date).toLocaleDateString('fr-FR')}`;
      await api.createNote({ title, content: draft.text.slice(0, MAX_NOTE_CHARS), projectId: draft.projectId });
      toast(draft.text.length > MAX_NOTE_CHARS ? 'Note enregistrée (transcription tronquée : trop longue pour une note).' : 'Transcription enregistrée dans vos notes.');
      r.clear();
      setBusy(null);
      onClose();
      await onNoteSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(null);
    }
  }

  function clear() {
    if (draft.text.trim() && !confirm('Effacer la transcription ?')) return;
    r.stop();
    r.clear();
  }

  return (
    <div className="meeting-panel">
      <div className="card-head">
        <div>
          <h2>🎙️ Transcrire une réunion</h2>
          <p className="muted small">
            Lancez l’écoute au début de la réunion (Teams, Zoom… dans une autre fenêtre) : ce qui est dit s’écrit ici au fil de l’eau. Le son n’est pas enregistré, seul
            le texte est gardé. À la fin, gardez-la comme note ou faites-en le compte rendu dans le journal du projet.
          </p>
        </div>
        <button className="btn btn-sm" onClick={onClose} title={r.recording ? 'La transcription continue en arrière-plan' : undefined}>Fermer</button>
      </div>

      {!r.supported ? (
        <EmptyState>
          <p>La transcription en direct n’est pas disponible dans ce navigateur. Ouvrez le hub dans <strong>Google Chrome</strong> ou <strong>Microsoft Edge</strong>.</p>
          <p className="muted small">Vous pouvez aussi coller la transcription fournie par Teams dans « Analyser une réunion » (onglet Journal d’un projet).</p>
        </EmptyState>
      ) : (
        <>
          <div className="meeting-controls">
            <div className="form-grid form-grid-4">
              <label className="field span-2">
                <span>Titre <span className="muted">(facultatif)</span></span>
                <input className="input" value={draft.title} onChange={(e) => setDraft({ title: e.target.value })} placeholder="ex. Point hebdo avec le prestataire" />
              </label>
              <label className="field">
                <span>Projet</span>
                <ProjectSelect value={draft.projectId} onChange={(v) => setDraft({ projectId: v })} projects={projects} emptyLabel="Aucun" />
              </label>
              <label className="field">
                <span>Date</span>
                <input className="input" type="date" value={draft.date} onChange={(e) => setDraft({ date: e.target.value })} />
              </label>
            </div>
            <div className="meeting-rec">
              {r.recording ? (
                <button className="btn btn-rec on" onClick={r.stop}><span className="rec-dot" /> Mettre en pause</button>
              ) : (
                <button className="btn btn-rec" onClick={r.start}>🎙️ {draft.text ? 'Reprendre la transcription' : 'Démarrer la transcription'}</button>
              )}
              <span className="muted small">
                {r.recording ? `Écoute en cours · ${formatElapsed(r.elapsed)}` : r.elapsed ? `En pause · ${formatElapsed(r.elapsed)} d’écoute` : 'Le navigateur vous demandera l’accès au micro.'}
                {words > 0 && ` · ${words.toLocaleString('fr-FR')} mots`}
              </span>
            </div>
            <ErrorBox error={r.error} />
            <p className="muted small">
              💡 Le micro capte ce qu’il entend : pour transcrire aussi les autres participants, écoutez la réunion sur les haut-parleurs plutôt qu’au casque. Vous pouvez
              changer de page pendant la réunion, la transcription continue (sans fermer l’onglet). La reconnaissance vocale est assurée par le navigateur (service de
              Google pour Chrome, de Microsoft pour Edge).
            </p>
          </div>

          <div className="mt">
            <textarea
              ref={textRef}
              className="input transcript meeting-text"
              value={draft.text}
              onChange={(e) => setDraft({ text: e.target.value })}
              placeholder="La transcription apparaîtra ici. Vous pouvez la corriger à tout moment, même pendant l’écoute."
            />
            {r.interim && <p className="meeting-interim">… {r.interim}</p>}
            {tooLong && <p className="due-late small">Transcription trop longue pour l’analyse ({MAX_PROJECT_TRANSCRIPT_CHARS.toLocaleString('fr-FR')} caractères au plus) : raccourcissez-la.</p>}
            <div className="actions mt">
              <button className="btn btn-danger-ghost" disabled={!draft.text && !r.elapsed} onClick={clear}>Effacer</button>
              <span className="tb-flex" />
              <button className="btn" disabled={!draft.text.trim() || !!busy} onClick={saveNote}>{busy === 'note' && <Spinner small />} 📝 Garder comme note</button>
              <button
                className="btn"
                disabled={draft.text.trim().length < 20 || tooLongForGandalf || !!busy}
                title={tooLongForGandalf ? `Trop long pour ${assistant.name} (${ASSISTANT_QUESTION_MAX.toLocaleString('fr-FR')} caractères au plus)` : `${assistant.name} propose les tickets, tâches et jalons à créer, dans tous les projets ; vous validez chacun`}
                onClick={() => openGandalf(gandalfIntro + draft.text.trim())}
              >
                🧙 Actions avec {assistant.name}
              </button>
              <button
                className="btn btn-ai"
                disabled={draft.text.trim().length < 20 || !draft.projectId || tooLong || !!busy}
                title={draft.projectId ? 'Compte rendu dans le journal du projet, avec les tickets, jalons et risques à valider' : 'Choisissez d’abord le projet'}
                onClick={analyse}
              >
                {busy === 'ia' ? <Spinner small /> : '✨'} Compte rendu par l’IA
              </button>
            </div>
            <p className="muted small">
              « Compte rendu par l’IA » (modèle économique, quelques centimes au plus) rédige le compte rendu dans le journal du projet et propose les actions à suivre ;
              rien n’est ajouté sans votre validation. La transcription brute reste jointe au compte rendu. « Actions avec {assistant.name} » propose directement les tickets, tâches
              et jalons à créer, quel que soit le projet, sans compte rendu.
              {!draft.projectId && <> Choisissez le projet pour l’activer, ou <Link to="/projets">créez-le</Link>.</>}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
