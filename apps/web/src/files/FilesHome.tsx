import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FILE_FORMAT_LABELS, decodeFile, scoreSpec, type FileSpec, type FileTypeSummary } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDate, shortUser, toast } from '../components/ui';
import { readLocalFile, session, formatSize, type LocalFile } from './local';

/** Score à partir duquel le type est choisi automatiquement. */
const AUTO_THRESHOLD = 0.8;

export function FilesHome() {
  const navigate = useNavigate();
  const { data: types, error, loading } = useLoad(() => api.listFileTypes(), []);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<{ file: LocalFile; ranked: { type: FileTypeSummary; score: number }[] } | null>(null);
  const [drag, setDrag] = useState(false);

  async function open(file: File) {
    if (!types?.length) {
      toast('Créez d’abord un type de fichier.', 'info');
      return;
    }
    setBusy(true);
    try {
      const local = await readLocalFile(file);
      // Reconnaissance du type, entièrement dans le navigateur.
      const specs = await Promise.all(types.filter((t) => t.currentVersion).map(async (t) => ({ type: t, spec: (await api.getFileType(t.id)).spec as FileSpec | null })));
      const ranked = specs
        .filter((s) => s.spec)
        .map(({ type, spec }) => ({ type, score: scoreSpec(spec!, decodeFile(local.bytes.subarray(0, 2_000_000), spec!.encoding).text, local.name) }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      if (best && best.score >= AUTO_THRESHOLD && (ranked[1]?.score ?? 0) < best.score - 0.05) {
        session.reading = { file: local, typeId: best.type.id };
        navigate('/fichiers/lecture');
      } else setChoices({ file: local, ranked });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Lecteur de fichiers</h1>
        <Link to="/fichiers/types/nouveau" className="btn btn-primary">+ Nouveau type de fichier</Link>
      </div>

      <label
        className={`dropzone${drag ? ' dropzone-on' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void open(f);
        }}
      >
        <input type="file" hidden onChange={(e) => e.target.files?.[0] && void open(e.target.files[0])} disabled={busy} />
        <div className="dropzone-icon">{busy ? <Spinner /> : '📂'}</div>
        <strong>Déposez un fichier à décortiquer</strong>
        <span className="muted small">ou cliquez pour le choisir — le type est reconnu automatiquement. Le fichier est lu sur votre poste et n’est envoyé nulle part.</span>
      </label>

      <h2 className="section-h">Types de fichiers paramétrés</h2>
      <ErrorBox error={error} />
      {loading && !types ? (
        <Spinner />
      ) : !types?.length ? (
        <EmptyState>Aucun type de fichier pour l’instant. Créez-en un à partir d’un fichier exemple (et, si vous l’avez, de sa documentation ou du code qui le génère).</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Format</th>
                <th className="num">Types de ligne</th>
                <th>Version</th>
                <th>Modifié</th>
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to={`/fichiers/types/${t.id}`} className="strong">{t.name}</Link>
                    {t.description && <div className="muted small">{t.description}</div>}
                  </td>
                  <td>{t.format ? FILE_FORMAT_LABELS[t.format] : <span className="muted">en préparation</span>}{t.fileNamePattern && <div className="muted small mono">{t.fileNamePattern}</div>}</td>
                  <td className="num">{t.recordTypeCount || '—'}</td>
                  <td>{t.currentVersion ? `v${t.currentVersion.label}` : '—'}</td>
                  <td className="small">{formatDate(t.updatedAt.slice(0, 10))}<div className="muted">{shortUser(t.updatedBy)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {choices && (
        <Modal title={`Quel est le type de « ${choices.file.name} » ?`} onClose={() => setChoices(null)}>
          <p className="muted small">{formatSize(choices.file.size)} — aucun type ne correspond avec certitude. Choisissez-en un, ou créez un nouveau type à partir de ce fichier.</p>
          {choices.ranked.map(({ type, score }) => (
            <button
              key={type.id}
              className="choice"
              onClick={() => {
                session.reading = { file: choices.file, typeId: type.id };
                navigate('/fichiers/lecture');
              }}
            >
              <span className="strong">{type.name}</span>
              <span className={`badge ${score >= 0.5 ? 'status-valide' : 'status-archive'}`}>{Math.round(score * 100)} % de correspondance</span>
            </button>
          ))}
          <button
            className="btn btn-ghost"
            onClick={() => {
              session.samples.set('nouveau', choices.file);
              navigate('/fichiers/types/nouveau');
            }}
          >
            + Créer un nouveau type à partir de ce fichier
          </button>
        </Modal>
      )}
    </div>
  );
}
