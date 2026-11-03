import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import {
  JOB_TYPE_LABELS,
  MAJOR_VERSION_STATUSES,
  nextVersionNumber,
  validationErrorsForStatus,
  versionLabel,
  type CdcDetail,
  type CdcDocument,
  type JobInfo,
  type Question,
  type Section,
} from '@samm/shared';
import { api, ApiError, download } from '../api';
import { useJobPolling } from '../hooks';
import { ErrorBox, Modal, Spinner, StatusBadge, formatDateTime, shortUser, toast } from '../components/ui';
import { MetaForm } from './MetaForm';
import { SectionsEditor } from './SectionsEditor';
import { QuestionsPanel } from './QuestionsPanel';
import { SourcesPanel } from './SourcesPanel';
import { VersionsPanel } from './VersionsPanel';
import { TranslationsPanel } from './TranslationsPanel';

type Tab = 'questions' | 'sources' | 'versions' | 'translations';

export function CdcEditorPage() {
  const { id = '' } = useParams();
  const [detail, setDetail] = useState<CdcDetail | null>(null);
  const [draft, setDraft] = useState<CdcDocument | null>(null);
  const [docKey, setDocKey] = useState(0);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('questions');
  const [refreshKey, setRefreshKey] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const [rework, setRework] = useState<Section | null>(null);

  const applyDetail = useCallback((d: CdcDetail) => {
    setDetail(d);
    setDraft(d.document);
    setDocKey((k) => k + 1);
    setJobId(d.activeJobId);
  }, []);

  const load = useCallback(async () => {
    try {
      const [d, qs] = await Promise.all([api.getCdc(id), api.listQuestions(id)]);
      applyDetail(d);
      setQuestions(qs);
      setLoadError(null);
    } catch (e) {
      setLoadError(e);
    }
  }, [id, applyDetail]);

  useEffect(() => {
    void load();
  }, [load]);

  const job = useJobPolling(jobId, async (j) => {
    setJobId(null);
    if (j.status === 'termine') {
      toast(`${JOB_TYPE_LABELS[j.type]} : ${j.step.charAt(0).toLowerCase()}${j.step.slice(1)}.`);
    } else {
      toast(`${JOB_TYPE_LABELS[j.type]} : ${j.error}`, 'error');
    }
    await load();
    setRefreshKey((k) => k + 1);
  });

  const dirty = useMemo(() => !!detail && !!draft && JSON.stringify(draft) !== JSON.stringify(detail.document), [detail, draft]);
  const busy = !!jobId;
  const aiDisabledReason = busy ? 'Une tâche IA est en cours.' : dirty ? 'Enregistrez vos modifications avant d’utiliser l’assistant.' : null;

  // Garde-fous contre la perte de modifications.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);

  const saveRef = useRef<() => void>(() => {});
  saveRef.current = () => dirty && !busy && setSaveOpen(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function onJob(j: JobInfo) {
    setJobId(j.id);
    toast(`${JOB_TYPE_LABELS[j.type]} lancée…`, 'info');
  }

  async function exportFr(format: 'docx' | 'pdf') {
    if (dirty) toast('L’export porte sur la dernière version enregistrée (vos modifications en cours n’y sont pas).', 'info');
    try {
      const res = await api.exportCdc(id, { format, lang: 'fr' });
      download(res.url, res.fileName);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  function goToSection(sectionId: string) {
    document.getElementById(`sec-${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (loadError) {
    return (
      <div className="page">
        <ErrorBox error={loadError} />
        <Link to="/cdc">← Retour à la liste</Link>
      </div>
    );
  }
  if (!detail || !draft) return <div className="page"><Spinner /></div>;

  const openCount = questions.filter((q) => q.status === 'ouverte' || q.status === 'repondue').length;

  return (
    <div className="editor-page">
      <header className="editor-bar">
        <div className="editor-bar-left">
          <Link to="/cdc" className="muted small">← Cahiers des charges</Link>
          <div className="editor-title">
            <span className="strong">{detail.title}</span>
            <span className="badge">v{detail.currentVersion.label}</span>
            <StatusBadge status={detail.status} />
            {dirty && <span className="badge badge-warn">Modifications non enregistrées</span>}
          </div>
          <div className="muted small">Modifié le {formatDateTime(detail.updatedAt)} par {shortUser(detail.updatedBy)}</div>
        </div>
        <div className="editor-bar-right">
          <ExportMenu onExport={exportFr} />
          {dirty && (
            <button className="btn" disabled={busy} onClick={() => applyDetail(detail)}>Annuler les modifications</button>
          )}
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => setSaveOpen(true)} title="Ctrl+S">
            Enregistrer
          </button>
        </div>
      </header>

      {job && busy && (
        <div className="job-banner">
          <Spinner small /> <strong>{JOB_TYPE_LABELS[job.type]}</strong> — {job.step}
          <span className="muted small"> · l’édition est suspendue pendant le traitement</span>
        </div>
      )}

      <div className="editor-layout">
        <div className="editor-main">
          <MetaForm meta={draft.meta} onChange={(meta) => setDraft({ ...draft, meta })} editable={!busy} />
          <SectionsWithAnchors
            doc={draft}
            onChange={setDraft}
            editable={!busy}
            cdcId={id}
            docKey={docKey}
            aiDisabledReason={aiDisabledReason}
            onRework={setRework}
          />
        </div>
        <aside className="editor-side">
          <div className="tabs">
            <button className={tab === 'questions' ? 'tab active' : 'tab'} onClick={() => setTab('questions')}>
              Questions {openCount > 0 && <span className="pill">{openCount}</span>}
            </button>
            <button className={tab === 'sources' ? 'tab active' : 'tab'} onClick={() => setTab('sources')}>Transcriptions</button>
            <button className={tab === 'versions' ? 'tab active' : 'tab'} onClick={() => setTab('versions')}>Versions</button>
            <button className={tab === 'translations' ? 'tab active' : 'tab'} onClick={() => setTab('translations')}>Traductions</button>
          </div>
          {tab === 'questions' && (
            <QuestionsPanel
              cdcId={id}
              questions={questions}
              setQuestions={setQuestions}
              baseSeq={detail.currentVersion.seq}
              aiDisabledReason={aiDisabledReason}
              onJob={onJob}
              onGoToSection={goToSection}
            />
          )}
          {tab === 'sources' && <SourcesPanel cdcId={id} baseSeq={detail.currentVersion.seq} refreshKey={refreshKey} aiDisabledReason={aiDisabledReason} onJob={onJob} />}
          {tab === 'versions' && (
            <VersionsPanel
              detail={detail}
              refreshKey={refreshKey}
              restoreDisabledReason={busy ? 'Une tâche IA est en cours.' : dirty ? 'Enregistrez ou annulez vos modifications avant de restaurer.' : null}
              onRestored={(d) => {
                applyDetail(d);
                setRefreshKey((k) => k + 1);
              }}
            />
          )}
          {tab === 'translations' && (
            <TranslationsPanel cdcId={id} currentLabel={detail.currentVersion.label} refreshKey={refreshKey} aiDisabledReason={aiDisabledReason} onJob={onJob} />
          )}
        </aside>
      </div>

      {saveOpen && (
        <SaveDialog
          detail={detail}
          draft={draft}
          onClose={() => setSaveOpen(false)}
          onSaved={(d) => {
            setSaveOpen(false);
            // Conserve les éditeurs ouverts (pas de rechargement) : le contenu enregistré est celui affiché.
            setDetail(d);
            setDraft(d.document);
            setRefreshKey((k) => k + 1);
          }}
          onConflict={load}
        />
      )}
      {rework && (
        <ReworkDialog
          section={rework}
          onClose={() => setRework(null)}
          onSubmit={async (instruction) => {
            try {
              onJob(await api.reworkSection(id, rework.id, detail.currentVersion.seq, instruction));
              setRework(null);
            } catch (e) {
              toast((e as Error).message, 'error');
            }
          }}
        />
      )}
    </div>
  );
}

function SectionsWithAnchors(props: Parameters<typeof SectionsEditor>[0]) {
  // Ancre de défilement par section (utilisée depuis le panneau des questions).
  useEffect(() => {
    document.querySelectorAll<HTMLElement>('.sections > section').forEach((el, i) => {
      const s = props.doc.sections[i];
      if (s) el.id = `sec-${s.id}`;
    });
  });
  return <SectionsEditor {...props} />;
}

function ExportMenu({ onExport }: { onExport: (f: 'docx' | 'pdf') => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu" onMouseLeave={() => setOpen(false)}>
      <button className="btn" onClick={() => setOpen(!open)}>Exporter ▾</button>
      {open && (
        <div className="menu-list">
          <button onClick={() => (setOpen(false), onExport('docx'))}>Word (.docx)</button>
          <button onClick={() => (setOpen(false), onExport('pdf'))}>PDF</button>
          <div className="menu-hint">Anglais / allemand : onglet « Traductions »</div>
        </div>
      )}
    </div>
  );
}

function SaveDialog({
  detail,
  draft,
  onClose,
  onSaved,
  onConflict,
}: {
  detail: CdcDetail;
  draft: CdcDocument;
  onClose: () => void;
  onSaved: (d: CdcDetail) => void;
  onConflict: () => void;
}) {
  const [comment, setComment] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const statusErrors = validationErrorsForStatus(draft);
  const titleMissing = !draft.meta.title.trim();
  const [maj, min] = detail.currentVersion.label.split('.').map(Number);
  const next = nextVersionNumber({ major: maj!, minor: min!, status: detail.status }, draft.meta.status);
  const isMajor = MAJOR_VERSION_STATUSES.includes(draft.meta.status) && next.minor === 0;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await api.saveCdc(detail.id, detail.currentVersion.seq, draft, comment.trim());
      toast(`Version ${res.version.label} enregistrée.`);
      onSaved(res.detail);
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  }

  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <Modal
      title={`Enregistrer la version ${versionLabel(next.major, next.minor)}`}
      onClose={onClose}
      footer={
        conflict ? (
          <>
            <span className="muted small">Copiez vos modifications si besoin avant de recharger.</span>
            <button className="btn btn-primary" onClick={() => (onClose(), onConflict())}>Recharger la dernière version</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>Annuler</button>
            <button className="btn btn-primary" disabled={saving || titleMissing || statusErrors.length > 0} onClick={save}>
              {saving ? <Spinner small /> : null} Enregistrer
            </button>
          </>
        )
      }
    >
      <ErrorBox error={error} />
      {titleMissing && <div className="alert alert-error">Le titre est obligatoire.</div>}
      {statusErrors.length > 0 && (
        <div className="alert alert-error">
          Pour passer au statut choisi : {statusErrors.join(' ')}
        </div>
      )}
      {isMajor && <div className="alert alert-info">Ce changement de statut crée une version majeure ({versionLabel(next.major, next.minor)}).</div>}
      <label className="field">
        <span>Commentaire (facultatif)</span>
        <input
          className="input"
          autoFocus
          value={comment}
          maxLength={500}
          placeholder="ex. Ajout des règles d’éligibilité"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !saving && !titleMissing && !statusErrors.length && void save()}
        />
      </label>
    </Modal>
  );
}

const REWORK_SUGGESTIONS = ['Plus concis', 'Plus détaillé et précis pour le prestataire', 'Reformuler en liste à puces', 'Corriger l’orthographe et le style', 'Ajouter des critères de recette'];

function ReworkDialog({ section, onClose, onSubmit }: { section: Section; onClose: () => void; onSubmit: (instruction: string) => Promise<void> }) {
  const [instruction, setInstruction] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <Modal
      title={`Retravailler « ${section.title} »`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={instruction.trim().length < 3 || sending}
            onClick={async () => {
              setSending(true);
              await onSubmit(instruction.trim());
              setSending(false);
            }}
          >
            ✨ Lancer
          </button>
        </>
      }
    >
      <p className="muted small">Seule cette section est envoyée à l’assistant. Le résultat crée une nouvelle version (vous pourrez revenir en arrière).</p>
      <div className="chips">
        {REWORK_SUGGESTIONS.map((s) => (
          <button key={s} className="chip" onClick={() => setInstruction(s)}>{s}</button>
        ))}
      </div>
      <textarea className="input" rows={4} autoFocus placeholder="Votre consigne…" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
    </Modal>
  );
}
