import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { anonymizeLine, fileSpecSchema, type FileSpec, type FileTypeDetail, type JobInfo } from '@samm/shared';
import { api } from '../api';
import { useJobPolling, useLoad } from '../hooks';
import { EmptyState, ErrorBox, Modal, Spinner, formatDateTime, shortUser, toast } from '../components/ui';
import { SpecEditor } from './SpecEditor';
import { AnomaliesView, StructuredView, Summary, useParsed } from './ParsedView';
import { formatSize, readLocalFile, session, type LocalFile } from './local';
import { withAiRecap } from '../assistant/AiRecap';

type Side = 'test' | 'ajuster' | 'versions' | 'contexte';

export function FileTypePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<FileTypeDetail | null>(null);
  const [draft, setDraft] = useState<FileSpec | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [side, setSide] = useState<Side>('test');
  const [testFile, setTestFile] = useState<LocalFile | null>(() => session.samples.get(id) ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);

  const apply = useCallback((d: FileTypeDetail) => {
    setDetail(d);
    setDraft(d.spec);
    setJobId(d.activeJobId);
  }, []);
  const load = useCallback(async () => {
    try {
      apply(await api.getFileType(id));
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [id, apply]);
  useEffect(() => {
    void load();
  }, [load]);

  const job = useJobPolling(jobId, async (j) => {
    setJobId(null);
    if (j.status === 'termine') toast(`${j.step}.`);
    else toast(j.error, 'error');
    await load();
    setRefreshKey((k) => k + 1);
  });

  const dirty = useMemo(() => !!detail && !!draft && JSON.stringify(draft) !== JSON.stringify(detail.spec), [detail, draft]);
  const validation = useMemo(() => (draft ? fileSpecSchema.safeParse(draft) : null), [draft]);
  const validSpec = validation?.success ? validation.data : null;
  const parsed = useParsed(validSpec, testFile);
  const busy = !!jobId;

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (confirm('La fiche a des modifications non enregistrées. Quitter quand même ?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);

  function onJob(j: JobInfo) {
    setJobId(j.id);
    toast('L’assistant travaille sur la fiche…', 'info');
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBox error={loadError} />
        <Link to="/fichiers">← Retour</Link>
      </div>
    );
  }
  if (!detail) return <div className="page"><Spinner /></div>;

  return (
    <div className="editor-page">
      <header className="editor-bar">
        <div className="editor-bar-left">
          <Link to="/fichiers" className="muted small">← Lecteur de fichiers</Link>
          <div className="editor-title">
            <span className="strong">{detail.name}</span>
            {detail.currentVersion && <span className="badge">fiche v{detail.currentVersion.label}</span>}
            {dirty && <span className="badge badge-warn">Modifications non enregistrées</span>}
          </div>
          <div className="muted small">{detail.description || `Modifiée le ${formatDateTime(detail.updatedAt)} par ${shortUser(detail.updatedBy)}`}</div>
        </div>
        <div className="editor-bar-right">
          <RenameButton detail={detail} onDone={apply} />
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              if (!confirm(`Supprimer le type « ${detail.name} » ?`)) return;
              try {
                await api.deleteFileType(id);
                navigate('/fichiers');
              } catch (e) {
                toast((e as Error).message, 'error');
              }
            }}
          >
            Supprimer
          </button>
          {dirty && <button className="btn" onClick={() => setDraft(detail.spec)}>Annuler les modifications</button>}
          <button className="btn btn-primary" disabled={!dirty || busy || !validSpec} onClick={() => setSaveOpen(true)}>Enregistrer la fiche</button>
        </div>
      </header>

      {job && busy && (
        <div className="job-banner">
          <Spinner small /> <strong>L’assistant prépare la fiche de lecture</strong> — {job.step}
          <span className="muted small"> · cela peut prendre une à deux minutes</span>
        </div>
      )}

      <div className="editor-layout editor-layout-wide">
        <div className="editor-main">
          {detail.remarks.length > 0 && (
            <div className="alert alert-info">
              <strong>Points à vérifier signalés par l’assistant :</strong>
              <ul>
                {detail.remarks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {validation && !validation.success && <div className="alert alert-error">Fiche invalide : {validation.error.issues.map((i) => i.message).join(' ; ')}</div>}
          {draft ? (
            <SpecEditor spec={draft} onChange={setDraft} editable={!busy} counts={parsed ? new Map([...parsed.result.byType].map(([k, v]) => [k, v.length])) : undefined} />
          ) : busy ? (
            <EmptyState>La fiche est en cours de création…</EmptyState>
          ) : (
            <EmptyState>
              La création de la fiche n’a pas abouti.{' '}
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  try {
                    const started = await withAiRecap(() => api.retryFileType(id));
                    // Annulé au récapitulatif : rien n'est lancé, la saisie est gardée.
                    if (!started) return;
                    onJob(started);
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
              >
                Relancer
              </button>
            </EmptyState>
          )}
        </div>

        <aside className="editor-side editor-side-wide">
          <div className="tabs">
            <button className={side === 'test' ? 'tab active' : 'tab'} onClick={() => setSide('test')}>Tester</button>
            <button className={side === 'ajuster' ? 'tab active' : 'tab'} onClick={() => setSide('ajuster')}>✨ Ajuster</button>
            <button className={side === 'versions' ? 'tab active' : 'tab'} onClick={() => setSide('versions')}>Versions</button>
            <button className={side === 'contexte' ? 'tab active' : 'tab'} onClick={() => setSide('contexte')}>Sources</button>
          </div>
          <div className="panel-body">
            {side === 'test' && (
              <>
                <TestFilePicker file={testFile} onFile={(f) => (setTestFile(f), session.samples.set(id, f))} />
                {testFile && !validSpec && <p className="muted small">La fiche doit être valide pour tester.</p>}
                {parsed && testFile && (
                  <>
                    <Summary parsed={parsed} fileName={testFile.name} />
                    {dirty && <p className="muted small">Test réalisé avec la fiche modifiée (non enregistrée).</p>}
                    <button
                      className="btn btn-sm"
                      disabled={dirty}
                      title={dirty ? 'Enregistrez la fiche d’abord' : ''}
                      onClick={() => {
                        session.reading = { file: testFile, typeId: id };
                        navigate('/fichiers/lecture');
                      }}
                    >
                      Ouvrir dans le lecteur complet
                    </button>
                    <h3>Anomalies</h3>
                    <AnomaliesView result={parsed.result} />
                    <h3>Aperçu</h3>
                    <StructuredView result={parsed.result} />
                  </>
                )}
              </>
            )}
            {side === 'ajuster' && (
              <AdjustPanel
                detail={detail}
                testFile={testFile}
                parsedUnknown={parsed ? [...parsed.result.unknown.map((i) => parsed.result.records[i]!.raw), ...[...new Set(parsed.result.fieldErrors.map((e) => e.record))].map((i) => parsed.result.records[i]!.raw)] : []}
                disabledReason={busy ? 'L’assistant travaille déjà sur la fiche.' : dirty ? 'Enregistrez ou annulez vos modifications d’abord.' : !detail.spec ? 'La fiche n’existe pas encore.' : null}
                onJob={onJob}
              />
            )}
            {side === 'versions' && <VersionsList id={id} detail={detail} refreshKey={refreshKey} disabled={busy || dirty} onRestored={(d) => (apply(d), setRefreshKey((k) => k + 1))} />}
            {side === 'contexte' && <ContextPanel detail={detail} />}
          </div>
        </aside>
      </div>

      {saveOpen && validSpec && (
        <SaveSpecDialog
          detail={detail}
          spec={validSpec}
          onClose={() => setSaveOpen(false)}
          onSaved={(d) => {
            setSaveOpen(false);
            apply(d);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

function TestFilePicker({ file, onFile }: { file: LocalFile | null; onFile: (f: LocalFile) => void }) {
  return (
    <div className="card-flat">
      <strong>Fichier de test</strong>
      {file ? <span className="small">{file.name} — {formatSize(file.size)}</span> : <span className="muted small">Choisissez un fichier de ce type : il est lu sur votre poste uniquement.</span>}
      <input type="file" onChange={async (e) => e.target.files?.[0] && onFile(await readLocalFile(e.target.files[0]))} />
    </div>
  );
}

const ADJUST_SUGGESTIONS = [
  'Corrige les lignes non reconnues',
  'Les montants sont en centimes',
  'Ajoute un contrôle du nombre de lignes annoncé en fin de fichier',
  'Donne des libellés plus clairs aux champs',
];

function AdjustPanel({ detail, testFile, parsedUnknown, disabledReason, onJob }: { detail: FileTypeDetail; testFile: LocalFile | null; parsedUnknown: string[]; disabledReason: string | null; onJob: (j: JobInfo) => void }) {
  const [instruction, setInstruction] = useState('');
  const [attach, setAttach] = useState(true);
  const lines = [...new Set(parsedUnknown)].slice(0, 30);
  // Mêmes précautions que pour l'exemple initial : lignes anonymisées si l'extrait l'était.
  const extra = attach ? lines.map((l) => (detail.anonymized ? anonymizeLine(l, 8) : l)).join('\n') : '';
  return (
    <>
      <p className="muted small">
        Décrivez ce qui ne va pas, en français. L’assistant corrige la fiche (nouvelle version, réversible). Coût : de l’ordre de quelques centimes.
      </p>
      <div className="chips">
        {ADJUST_SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => setInstruction(s)}>{s}</button>
        ))}
      </div>
      <textarea className="input" rows={5} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="ex. La ligne 13 a un sous-type en position 3 : 13.1 = adresse de facturation, 13.2 = adresse de livraison." />
      {testFile && lines.length > 0 && (
        <label className="check small">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} /> Joindre les {lines.length} ligne(s) en anomalie du fichier de test
          {detail.anonymized ? ' (anonymisées)' : ''}
        </label>
      )}
      <button
        className="btn btn-primary btn-block"
        disabled={!!disabledReason || instruction.trim().length < 3}
        title={disabledReason ?? ''}
        onClick={async () => {
          try {
            const started = await withAiRecap(() => api.adjustFileType(detail.id, { baseSeq: detail.currentVersion!.seq, instruction: instruction.trim(), extraLines: extra }));
            // Annulé au récapitulatif : rien n'est lancé, la saisie est gardée.
            if (!started) return;
            onJob(started);
            setInstruction('');
          } catch (e) {
            toast((e as Error).message, 'error');
          }
        }}
      >
        ✨ Ajuster la fiche
      </button>
    </>
  );
}

function VersionsList({ id, detail, refreshKey, disabled, onRestored }: { id: string; detail: FileTypeDetail; refreshKey: number; disabled: boolean; onRestored: (d: FileTypeDetail) => void }) {
  const { data } = useLoad(() => api.listFileTypeVersions(id), [id, refreshKey]);
  if (!data) return <Spinner />;
  if (!data.length) return <EmptyState>Aucune version.</EmptyState>;
  const ORIGIN = { ia: 'Assistant IA', manuel: 'Édition manuelle', restauration: 'Restauration' } as const;
  return (
    <ol className="versions">
      {data.map((v) => (
        <li key={v.seq} className={v.seq === detail.currentVersion?.seq ? 'version current' : 'version'}>
          <div className="version-head">
            <strong>v{v.label}</strong>
            <span className={`badge origin-${v.origin}`}>{ORIGIN[v.origin]}</span>
            {v.seq === detail.currentVersion?.seq && <span className="badge">actuelle</span>}
          </div>
          <div className="muted small">{formatDateTime(v.createdAt)} · {shortUser(v.author)}</div>
          {v.comment && <div className="small">{v.comment}</div>}
          {v.seq !== detail.currentVersion?.seq && (
            <button
              className="btn-link small"
              disabled={disabled}
              onClick={async () => {
                if (!confirm(`Restaurer la version ${v.label} de la fiche ?`)) return;
                try {
                  const res = await api.restoreFileTypeVersion(id, v.seq, detail.currentVersion!.seq);
                  toast(`Version ${v.label} restaurée.`);
                  onRestored(res.detail);
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              }}
            >
              Restaurer cette version
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function ContextPanel({ detail }: { detail: FileTypeDetail }) {
  return (
    <>
      <p className="muted small">Ce que l’assistant a reçu pour construire la fiche. Le fichier exemple complet n’a jamais quitté votre poste.</p>
      <h3>Fichier exemple</h3>
      <div className="small">{detail.sampleFileName || '—'}</div>
      <h3>Documentation</h3>
      {detail.documents.length ? detail.documents.map((d) => <div key={d.name} className="small">📎 {d.name} ({d.chars.toLocaleString('fr-FR')} caractères)</div>) : <div className="muted small">Aucune</div>}
      <h3>Explications</h3>
      <pre className="notes">{detail.notes || '—'}</pre>
      <h3>Extrait envoyé</h3>
      <pre className="notes raw">{detail.excerpt}</pre>
    </>
  );
}

function RenameButton({ detail, onDone }: { detail: FileTypeDetail; onDone: (d: FileTypeDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(detail.name);
  const [description, setDescription] = useState(detail.description);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Renommer</button>
      {open && (
        <Modal
          title="Renommer le type de fichier"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>Annuler</button>
              <button
                className="btn btn-primary"
                disabled={!name.trim()}
                onClick={async () => {
                  try {
                    onDone(await api.renameFileType(detail.id, name.trim(), description));
                    setOpen(false);
                  } catch (e) {
                    toast((e as Error).message, 'error');
                  }
                }}
              >
                Enregistrer
              </button>
            </>
          }
        >
          <label className="field">
            <span>Nom</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Description</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </Modal>
      )}
    </>
  );
}

function SaveSpecDialog({ detail, spec, onClose, onSaved }: { detail: FileTypeDetail; spec: FileSpec; onClose: () => void; onSaved: (d: FileTypeDetail) => void }) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const res = await api.saveFileTypeSpec(detail.id, detail.currentVersion?.seq ?? 0, spec, comment.trim());
      toast(`Fiche v${res.version.label} enregistrée.`);
      onSaved(res.detail);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Enregistrer la fiche de lecture"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? <Spinner small /> : null} Enregistrer</button>
        </>
      }
    >
      <ErrorBox error={error} />
      <label className="field">
        <span>Commentaire (facultatif)</span>
        <input className="input" autoFocus value={comment} maxLength={500} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} placeholder="ex. Montant en centimes" />
      </label>
    </Modal>
  );
}
