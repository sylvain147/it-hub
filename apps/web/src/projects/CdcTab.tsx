import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { MAX_PROJECT_TRANSCRIPT_CHARS, NOTE_KIND_ICONS, PRESTA_STATUS_LABELS, type CdcSummary } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, StatusBadge, formatDate, shortUser, toast } from '../components/ui';
import { DueLabel, days, useProject } from './common';

export function CdcTab() {
  const { project, reload } = useProject();
  const [generate, setGenerate] = useState<string | null | false>(false);
  const [attach, setAttach] = useState(false);

  async function detach(c: CdcSummary) {
    if (!confirm(`Détacher « ${c.title} » du projet ? Le cahier des charges est conservé.`)) return;
    try {
      await api.attachCdc(c.id, null);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const withoutCdc = project.items.prestations.filter((p) => !p.cdcId && p.status !== 'annule');

  return (
    <div>
      <div className="toolbar-row">
        <button className="btn btn-primary" onClick={() => setGenerate(null)}>✨ Rédiger un cahier des charges</button>
        <button className="btn" onClick={() => setAttach(true)}>Rattacher un CDC existant</button>
      </div>
      <p className="muted small">
        Le cahier des charges est rédigé à partir de la fiche projet (description, objectifs, hors périmètre), de la prestation choisie, du planning, des risques et des notes
        du journal que vous sélectionnez — et, si vous en avez une, d’une transcription de réunion. Il reste ensuite modifiable, versionné et exportable en Word et PDF.
      </p>
      {withoutCdc.length > 0 && (
        <div className="alert alert-info">
          Prestation{withoutCdc.length > 1 ? 's' : ''} sans cahier des charges :{' '}
          {withoutCdc.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ', '}
              <button className="btn-link" onClick={() => setGenerate(p.id)}>{p.prestataire} — {p.objet}</button>
            </span>
          ))}
        </div>
      )}
      {project.cdcs.length === 0 ? (
        <EmptyState>Aucun cahier des charges pour ce projet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cahier des charges</th>
                <th>Statut</th>
                <th>Prestataire</th>
                <th>Échéance</th>
                <th className="num">Estimation</th>
                <th>Version</th>
                <th className="num">Questions</th>
                <th>Modifié</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {project.cdcs.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/cdc/${c.id}`} className="strong">📄 {c.title}</Link></td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.prestataire || <span className="muted">—</span>}</td>
                  <td>{c.nextJalon ? <><DueLabel date={c.nextJalon.date} /> <div className="muted small">{c.nextJalon.label}</div></> : <span className="muted">—</span>}</td>
                  <td className="num">{days(c.estimationJours)}</td>
                  <td>v{c.currentVersion.label}</td>
                  <td className="num">{c.openQuestions > 0 ? <span className="pill">{c.openQuestions}</span> : <span className="muted">0</span>}</td>
                  <td className="small">{formatDate(c.updatedAt.slice(0, 10))}<div className="muted">{shortUser(c.updatedBy)}</div></td>
                  <td className="num"><button className="btn-icon" title="Détacher du projet" onClick={() => void detach(c)}>⛓️‍💥</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {generate !== false && <GenerateDialog prestationId={generate} onClose={() => setGenerate(false)} />}
      {attach && <AttachDialog onClose={() => setAttach(false)} />}
    </div>
  );
}

function GenerateDialog({ prestationId, onClose }: { prestationId: string | null; onClose: () => void }) {
  const { project } = useProject();
  const navigate = useNavigate();
  const prestas = project.items.prestations.filter((p) => p.status !== 'annule');
  const [presta, setPresta] = useState<string>(prestationId ?? (prestas.length === 1 ? prestas[0]!.id : ''));
  const [title, setTitle] = useState('');
  const [noteIds, setNoteIds] = useState<Set<string>>(() => new Set(project.items.notes.filter((n) => n.kind === 'compte_rendu' || n.kind === 'decision').slice(0, 5).map((n) => n.id)));
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const notes = project.items.notes.filter((n) => n.kind !== 'rapport');
  const p = prestas.find((x) => x.id === presta);
  const hasMaterial = !!(project.description.trim() || project.objectifs.trim() || noteIds.size || transcript.trim() || p);

  async function create(withAi: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.createProjectCdc(project.id, { title, prestationId: presta || null, noteIds: [...noteIds], transcript: withAi ? transcript : '', withAi });
      navigate(`/cdc/${res.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Rédiger un cahier des charges"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={() => void create(false)} title="Crée un CDC vide, pré-rempli avec le projet, le prestataire, les jalons et l’estimation">Créer un CDC vide</button>
          <span className="tb-flex" />
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-ai" disabled={busy || !hasMaterial} onClick={() => void create(true)}>{busy ? <Spinner small /> : '✨'} Rédiger avec l’assistant</button>
        </>
      }
    >
      <ErrorBox error={error} />
      {!hasMaterial && <div className="alert alert-info">Décrivez d’abord le projet (vue d’ensemble), choisissez une prestation, une note du journal ou collez une transcription : l’assistant n’invente rien.</div>}
      <div className="form-grid">
        <label className="field">
          <span>Prestation concernée</span>
          <select className="input" value={presta} onChange={(e) => setPresta(e.target.value)}>
            <option value="">— Tout le projet —</option>
            {prestas.map((x) => (
              <option key={x.id} value={x.id}>{x.prestataire} — {x.objet} ({PRESTA_STATUS_LABELS[x.status]}){x.cdcId ? ' · a déjà un CDC' : ''}</option>
            ))}
          </select>
          <span className="muted small">{p ? `Prestataire « ${p.prestataire} »${p.chargeJours != null ? `, estimation ${days(p.chargeJours)}` : ''} repris dans l’en-tête du CDC.` : 'Le prestataire et l’estimation pourront être saisis dans le CDC.'}</span>
        </label>
        <label className="field">
          <span>Titre <span className="muted">(facultatif)</span></span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={p ? `${project.name} — ${p.objet}` : project.name} />
        </label>
      </div>
      {notes.length > 0 && (
        <div className="field">
          <span>Notes du journal à fournir à l’assistant</span>
          <div className="note-picks">
            {notes.map((n) => (
              <label key={n.id} className="check">
                <input
                  type="checkbox"
                  checked={noteIds.has(n.id)}
                  onChange={() =>
                    setNoteIds((s) => {
                      const next = new Set(s);
                      if (next.has(n.id)) next.delete(n.id);
                      else next.add(n.id);
                      return next;
                    })
                  }
                />
                {NOTE_KIND_ICONS[n.kind]} {n.title} <span className="muted small">{n.date && formatDate(n.date)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="field">
        <span>Transcription d’une réunion <span className="muted">(facultatif : triée par le modèle économique avant la rédaction)</span></span>
        <textarea className="input transcript transcript-sm" value={transcript} maxLength={MAX_PROJECT_TRANSCRIPT_CHARS} onChange={(e) => setTranscript(e.target.value)} placeholder="Collez ici la transcription d’une réunion dédiée à ce besoin…" />
      </label>
      <p className="muted small">Repris automatiquement : jalons non atteints → échéances du CDC, statut du projet → phase, nom du projet. Coût indicatif : ~0,10 $.</p>
    </Modal>
  );
}

function AttachDialog({ onClose }: { onClose: () => void }) {
  const { project, reload } = useProject();
  const { data, loading } = useLoad(() => api.listCdcs(), []);
  const [q, setQ] = useState('');
  const candidates = (data ?? []).filter((c) => c.projectId !== project.id && (!q.trim() || `${c.title} ${c.prestataire} ${c.projet}`.toLowerCase().includes(q.trim().toLowerCase())));

  async function attach(c: CdcSummary) {
    try {
      await api.attachCdc(c.id, project.id);
      await reload();
      toast(`« ${c.title} » rattaché au projet.`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <Modal title="Rattacher un cahier des charges existant" onClose={onClose}>
      <input className="input" autoFocus placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
      {loading ? (
        <Spinner />
      ) : candidates.length === 0 ? (
        <p className="muted">Aucun cahier des charges à rattacher.</p>
      ) : (
        candidates.map((c) => (
          <button key={c.id} className="choice" onClick={() => void attach(c)}>
            <span>
              <strong>{c.title}</strong>
              <div className="muted small">{[c.prestataire, c.projet, `v${c.currentVersion.label}`].filter(Boolean).join(' · ')}</div>
            </span>
            <span className="muted small">{c.projectId ? 'Autre projet' : 'Sans projet'}</span>
          </button>
        ))
      )}
    </Modal>
  );
}
