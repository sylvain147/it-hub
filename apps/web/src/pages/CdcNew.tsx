import { useState } from 'react';
import { useNavigate } from 'react-router';
import { MAX_TRANSCRIPT_CHARS, PROJECT_PHASES, PROJECT_PHASE_LABELS, type ProjectPhase } from '@samm/shared';
import { api } from '../api';
import { ErrorBox, Spinner } from '../components/ui';

export function CdcNew() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [prestataire, setPrestataire] = useState('');
  const [projet, setProjet] = useState('');
  const [phase, setPhase] = useState<ProjectPhase | ''>('');
  const [estimation, setEstimation] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function create(withAi: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createCdc({
        meta: {
          ...(title.trim() ? { title: title.trim() } : {}),
          prestataire: prestataire.trim(),
          projet: projet.trim(),
          phase: phase || null,
          estimationJours: estimation ? Number(estimation.replace(',', '.')) : null,
        },
        ...(withAi ? { transcript, transcriptTitle: title.trim() } : {}),
      });
      navigate(`/cdc/${res.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  const tokens = Math.round(transcript.length / 3.5);
  return (
    <div className="page page-narrow">
      <h1>Nouveau cahier des charges</h1>
      <p className="muted">
        Collez la transcription de la réunion telle quelle : l’assistant fait le tri, rédige le cahier des charges selon le modèle de l’équipe et
        prépare la liste des questions à éclaircir. Les champs ci-dessous sont facultatifs : ce que vous renseignez prime sur ce que l’IA déduit.
      </p>
      <ErrorBox error={error} />
      <div className="card form-grid">
        <label className="field span-2">
          <span>Titre</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Migration de l’offre Coliéco vers l’offre Essentiel" />
        </label>
        <label className="field">
          <span>Prestataire</span>
          <input className="input" value={prestataire} onChange={(e) => setPrestataire(e.target.value)} />
        </label>
        <label className="field">
          <span>Projet</span>
          <input className="input" value={projet} onChange={(e) => setProjet(e.target.value)} />
        </label>
        <label className="field">
          <span>Phase du projet</span>
          <select className="input" value={phase} onChange={(e) => setPhase(e.target.value as ProjectPhase | '')}>
            <option value="">—</option>
            {PROJECT_PHASES.map((p) => (
              <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Estimation (jours/homme)</span>
          <input className="input" inputMode="decimal" value={estimation} onChange={(e) => setEstimation(e.target.value.replace(/[^\d.,]/g, ''))} />
        </label>
        <label className="field span-2">
          <span>Transcription de la réunion</span>
          <textarea
            className="input transcript"
            value={transcript}
            maxLength={MAX_TRANSCRIPT_CHARS}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Collez ici la transcription brute (Teams, notes, dictée…)"
          />
          <span className="muted small">
            {transcript.length.toLocaleString('fr-FR')} caractères (≈ {tokens.toLocaleString('fr-FR')} tokens). La transcription n’est lue qu’une
            fois, par le modèle le plus économique ; seules les notes qu’il en tire servent à la rédaction.
          </span>
        </label>
      </div>
      <div className="actions">
        <button className="btn" disabled={busy} onClick={() => create(false)}>Créer un cahier des charges vide</button>
        <button className="btn btn-primary" disabled={busy || transcript.trim().length < 50} onClick={() => create(true)}>
          {busy ? <Spinner small /> : '✨'} Générer avec l’assistant
        </button>
      </div>
    </div>
  );
}
