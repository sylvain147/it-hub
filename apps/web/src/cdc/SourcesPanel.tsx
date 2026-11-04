import { useState } from 'react';
import { MAX_TRANSCRIPT_CHARS, type JobInfo } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, Modal, Spinner, formatDateTime, shortUser, toast } from '../components/ui';

interface Props {
  cdcId: string;
  baseSeq: number;
  refreshKey: number;
  aiDisabledReason: string | null;
  onJob: (j: JobInfo) => void;
}

export function SourcesPanel({ cdcId, baseSeq, refreshKey, aiDisabledReason, onJob }: Props) {
  const { data: sources, loading } = useLoad(() => api.listSources(cdcId), [cdcId, refreshKey]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [raw, setRaw] = useState<{ title: string; text: string } | null>(null);

  async function submit() {
    try {
      onJob(await api.addSource(cdcId, { baseSeq, title: title.trim(), text }));
      setTitle('');
      setText('');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function showRaw(sid: string, t: string) {
    try {
      setRaw({ title: t, text: await api.sourceText(cdcId, sid) });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="panel-body">
      <div className="card-flat">
        <h3>Ajouter une transcription</h3>
        <p className="muted small">Une nouvelle réunion ? L’assistant intègre les nouvelles informations au cahier des charges existant et met à jour les questions.</p>
        <input className="input" placeholder="Titre (ex. Réunion de suivi du 12/11)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={6} maxLength={MAX_TRANSCRIPT_CHARS} placeholder="Collez la transcription…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-primary btn-block" disabled={text.trim().length < 50 || !!aiDisabledReason} title={aiDisabledReason ?? ''} onClick={submit}>
          ✨ Intégrer au cahier des charges
        </button>
      </div>

      <h3>Transcriptions utilisées</h3>
      {loading && !sources ? (
        <Spinner />
      ) : !sources?.length ? (
        <EmptyState>Aucune transcription.</EmptyState>
      ) : (
        sources.map((s) => (
          <div key={s.id} className="source">
            <div className="source-head">
              <strong>{s.title || 'Transcription'}</strong>
              <span className="muted small">{formatDateTime(s.createdAt)} · {shortUser(s.createdBy)} · {s.charCount.toLocaleString('fr-FR')} car.</span>
            </div>
            <div className="source-actions">
              <button className="btn-link small" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Masquer les notes' : 'Notes extraites'}</button>
              <button className="btn-link small" onClick={() => showRaw(s.id, s.title)}>Texte brut</button>
            </div>
            {open === s.id && <pre className="notes">{s.notes}</pre>}
          </div>
        ))
      )}
      {raw && (
        <Modal title={raw.title || 'Transcription'} onClose={() => setRaw(null)} wide>
          <pre className="notes">{raw.text}</pre>
        </Modal>
      )}
    </div>
  );
}
