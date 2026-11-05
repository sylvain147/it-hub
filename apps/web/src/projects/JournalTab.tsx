import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  HEALTH_ICONS,
  HEALTH_LABELS,
  MAX_PROJECT_TRANSCRIPT_CHARS,
  NOTE_KINDS,
  NOTE_KIND_ICONS,
  NOTE_KIND_LABELS,
  PRIORITY_LABELS,
  RISK_LEVEL_LABELS,
  type Note,
  type NoteKind,
} from '@samm/shared';
import { api } from '../api';
import { EmptyState, Modal, Spinner, formatDate, formatDateTime, shortUser, toast } from '../components/ui';
import { ItemModal, MarkdownField, MarkdownView, useItemActions, useProject } from './common';
import { fieldsOf } from './OverviewTab';
import { hasPending } from './ProjectPage';

export function JournalTab() {
  const { project, jobBusy, onJob } = useProject();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState<NoteKind | ''>('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Note | NoteKind | null>(null);
  const [digest, setDigest] = useState(false);

  useEffect(() => {
    if (params.get('analyser')) {
      setDigest(true);
      setParams({ onglet: 'journal' }, { replace: true });
    }
  }, [params, setParams]);

  const notes = project.items.notes.filter((n) => (!kind || n.kind === kind) && (!q.trim() || `${n.title} ${n.content}`.toLowerCase().includes(q.trim().toLowerCase())));

  async function report() {
    try {
      onJob(await api.progressReport(project.id));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div>
      <div className="toolbar-row">
        <div className="menu-inline">
          {(['compte_rendu', 'decision', 'info', 'alerte'] as NoteKind[]).map((k) => (
            <button key={k} className="btn btn-sm" onClick={() => setEditing(k)}>{NOTE_KIND_ICONS[k]} {NOTE_KIND_LABELS[k]}</button>
          ))}
        </div>
        <span className="tb-flex" />
        <button className="btn btn-ai" disabled={jobBusy} onClick={() => setDigest(true)} title="Coller une transcription ou des notes : l’assistant rédige le compte rendu et propose tâches, jalons et risques">
          ✨ Analyser une réunion
        </button>
        <button className="btn btn-ai" disabled={jobBusy} onClick={report} title="Rédige un rapport d’avancement à partir des données du projet">
          ✨ Rapport d’avancement
        </button>
      </div>
      <div className="filters">
        <input className="input" placeholder="Rechercher dans le journal…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as NoteKind | '')}>
          <option value="">Toutes les notes</option>
          {NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_ICONS[k]} {NOTE_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      {project.items.notes.length === 0 ? (
        <EmptyState>
          Le journal garde la trace du projet : comptes rendus de réunion, décisions, informations, points d’attention, rapports d’avancement.
          <br />
          Astuce : collez la transcription d’une réunion dans « Analyser une réunion » ; l’assistant rédige le compte rendu et propose les actions à suivre.
        </EmptyState>
      ) : notes.length === 0 ? (
        <EmptyState>Aucune note ne correspond.</EmptyState>
      ) : (
        <div className="journal">
          {notes.map((n) => <NoteCard key={n.id} note={n} onEdit={() => setEditing(n)} />)}
        </div>
      )}
      {editing && <NoteDialog note={typeof editing === 'string' ? null : editing} kind={typeof editing === 'string' ? editing : editing.kind} onClose={() => setEditing(null)} />}
      {digest && <DigestDialog onClose={() => setDigest(false)} />}
    </div>
  );
}

function NoteCard({ note, onEdit }: { note: Note; onEdit: () => void }) {
  const { project, reload, setProject } = useProject();
  const actions = useItemActions();
  const long = note.content.length > 1200;
  const [expanded, setExpanded] = useState(!long);
  const [source, setSource] = useState<string | null>(null);

  async function togglePin() {
    await api.updateItem(project.id, 'notes', note.id, { pinned: !note.pinned });
    await reload();
  }

  async function applyHealth() {
    if (!note.suggestedHealth) return;
    try {
      setProject(await api.updateProject(project.id, project.rev, { ...fieldsOf(project), health: note.suggestedHealth }));
      toast(`Météo passée à « ${HEALTH_LABELS[note.suggestedHealth]} ».`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  async function showSource() {
    try {
      setSource((await api.noteSource(project.id, note.id)).text);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  function copy() {
    void navigator.clipboard.writeText(`${note.title}${note.date ? ` (${formatDate(note.date)})` : ''}\n\n${note.content}`).then(() => toast('Note copiée (Markdown) : prête à coller dans un e-mail.'));
  }

  return (
    <article className={`note note-${note.kind}${note.pinned ? ' note-pinned' : ''}`}>
      <div className="note-head">
        <span className="note-icon">{NOTE_KIND_ICONS[note.kind]}</span>
        <div className="note-title">
          <strong>{note.title}</strong>
          <div className="muted small">
            {NOTE_KIND_LABELS[note.kind]} · {note.date ? formatDate(note.date) : formatDate(note.createdAt.slice(0, 10))} · {shortUser(note.createdBy)}
            {note.origin === 'ia' && <span className="badge origin-ia">Assistant IA</span>}
            {note.pinned && <span className="badge">📌 Épinglée</span>}
          </div>
        </div>
        <div className="note-actions">
          <button className="btn-icon" title={note.pinned ? 'Désépingler' : 'Épingler en haut du journal'} onClick={() => void togglePin()}>📌</button>
          <button className="btn-icon" title="Copier" onClick={copy}>⧉</button>
          <button className="btn-icon" title="Modifier" onClick={onEdit}>✏️</button>
          <button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('notes', note.id, note.title)}>🗑</button>
        </div>
      </div>
      {note.suggestedHealth && note.suggestedHealth !== project.health && (
        <div className="alert alert-info note-alert">
          Météo proposée par l’assistant : {HEALTH_ICONS[note.suggestedHealth]} <strong>{HEALTH_LABELS[note.suggestedHealth]}</strong> (actuelle : {HEALTH_LABELS[project.health]}).{' '}
          <button className="btn-link" onClick={() => void applyHealth()}>Appliquer</button>
        </div>
      )}
      <div className={expanded ? '' : 'note-collapsed'}>
        <MarkdownView markdown={note.content} />
      </div>
      <div className="row-actions">
        {long && <button className="btn-link small" onClick={() => setExpanded(!expanded)}>{expanded ? 'Réduire' : 'Lire la suite'}</button>}
        {note.hasSource && <button className="btn-link small" onClick={() => void showSource()}>Voir la transcription d’origine</button>}
      </div>
      {note.suggestions && <Suggestions note={note} />}
      {source !== null && (
        <Modal title={`Transcription — ${note.title}`} wide onClose={() => setSource(null)}>
          <pre className="notes">{source}</pre>
        </Modal>
      )}
    </article>
  );
}

/** Propositions de l'assistant : cochées par défaut, l'utilisateur décoche ce qu'il ne veut pas. */
function Suggestions({ note }: { note: Note }) {
  const { project, setProject } = useProject();
  const s = note.suggestions!;
  const [checked, setChecked] = useState(() => ({
    tasks: new Set(s.tasks.map((_, i) => i)),
    jalons: new Set(s.jalons.map((_, i) => i)),
    risks: new Set(s.risks.map((_, i) => i)),
  }));
  const [busy, setBusy] = useState(false);
  const pending = hasPending(s);
  const total = s.tasks.length + s.jalons.length + s.risks.length;
  if (!total) return null;

  const toggle = (k: keyof typeof checked, i: number) =>
    setChecked((c) => {
      const next = new Set(c[k]);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return { ...c, [k]: next };
    });

  async function apply(all: boolean) {
    setBusy(true);
    try {
      const pick = (k: keyof typeof checked) => (all ? [...checked[k]] : []);
      setProject(await api.applySuggestions(project.id, note.id, { tasks: pick('tasks'), jalons: pick('jalons'), risks: pick('risks') }));
      toast(all ? 'Propositions ajoutées au projet.' : 'Propositions ignorées.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const Row = ({ k, i, state, children }: { k: keyof typeof checked; i: number; state: string; children: React.ReactNode }) => (
    <li className={`sugg sugg-${state}`}>
      {state === 'proposee' ? (
        <label className="check"><input type="checkbox" checked={checked[k].has(i)} onChange={() => toggle(k, i)} /> <span>{children}</span></label>
      ) : (
        <span>{state === 'acceptee' ? '✅' : '✖️'} {children}</span>
      )}
    </li>
  );

  return (
    <div className={`suggestions${pending ? ' suggestions-pending' : ''}`}>
      <div className="strong">✨ {pending ? 'Propositions de l’assistant — cochez ce qu’il faut ajouter au projet' : 'Propositions de l’assistant (traitées)'}</div>
      {s.tasks.length > 0 && (
        <>
          <div className="muted small">Tâches</div>
          <ul className="list-plain">
            {s.tasks.map((t, i) => (
              <Row key={i} k="tasks" i={i} state={t.state}>
                {t.title}
                {t.assignee && <span className="badge">{t.assignee}</span>}
                {t.dueDate && <span className="muted small"> · {formatDate(t.dueDate)}</span>}
                {t.priority !== 'normale' && <span className="muted small"> · {PRIORITY_LABELS[t.priority]}</span>}
              </Row>
            ))}
          </ul>
        </>
      )}
      {s.jalons.length > 0 && (
        <>
          <div className="muted small">Jalons</div>
          <ul className="list-plain">
            {s.jalons.map((j, i) => (
              <Row key={i} k="jalons" i={i} state={j.state}>
                {j.label} <span className="muted small">· {j.date ? formatDate(j.date) : 'date à définir'}</span>
              </Row>
            ))}
          </ul>
        </>
      )}
      {s.risks.length > 0 && (
        <>
          <div className="muted small">Risques</div>
          <ul className="list-plain">
            {s.risks.map((r, i) => (
              <Row key={i} k="risks" i={i} state={r.state}>
                {r.title} <span className="muted small">· probabilité {RISK_LEVEL_LABELS[r.probability].toLowerCase()}, impact {RISK_LEVEL_LABELS[r.impact].toLowerCase()}</span>
              </Row>
            ))}
          </ul>
        </>
      )}
      {pending && (
        <div className="row-actions">
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void apply(true)}>
            {busy && <Spinner small />} Ajouter la sélection au projet
          </button>
          <button className="btn btn-sm" disabled={busy} onClick={() => void apply(false)}>Tout ignorer</button>
        </div>
      )}
    </div>
  );
}

function NoteDialog({ note, kind, onClose }: { note: Note | null; kind: NoteKind; onClose: () => void }) {
  const actions = useItemActions();
  const [f, setF] = useState({
    kind: note?.kind ?? kind,
    title: note?.title ?? '',
    date: note?.date ?? new Date().toISOString().slice(0, 10),
    content: note?.content ?? '',
    pinned: note?.pinned ?? false,
  });
  return (
    <ItemModal title={note ? 'Modifier la note' : `${NOTE_KIND_ICONS[f.kind]} ${NOTE_KIND_LABELS[f.kind]}`} wide onClose={onClose} canSave={!!f.title.trim()} onSave={() => actions.save('notes', note?.id ?? null, f)}>
      <label className="field">
        <span>Titre *</span>
        <input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'decision' ? 'ex. Bascule automatique en Colissimo sans surcoût' : 'ex. Comité de pilotage n°3'} />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Type</span>
          <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as NoteKind })}>
            {NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_ICONS[k]} {NOTE_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
      </div>
      <div className="field span-2">
        <span>Contenu</span>
        <MarkdownField value={f.content} onChange={(content) => setF((x) => ({ ...x, content }))} placeholder="Rédigez ici…" />
      </div>
      <label className="check span-2"><input type="checkbox" checked={f.pinned} onChange={(e) => setF({ ...f, pinned: e.target.checked })} /> Épingler en haut du journal</label>
      {note && <p className="muted small span-2">Créée le {formatDateTime(note.createdAt)} par {shortUser(note.createdBy)}{note.updatedAt !== note.createdAt && ` · modifiée le ${formatDateTime(note.updatedAt)} par ${shortUser(note.updatedBy)}`}</p>}
    </ItemModal>
  );
}

function DigestDialog({ onClose }: { onClose: () => void }) {
  const { project, onJob } = useProject();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  async function send() {
    setSending(true);
    try {
      onJob(await api.digestMeeting(project.id, { title, date, text }));
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
      setSending(false);
    }
  }
  return (
    <Modal
      title="Analyser une réunion"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="muted small">Modèle économique · quelques centimes au plus</span>
          <span className="tb-flex" />
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-ai" disabled={text.trim().length < 20 || sending} onClick={send}>{sending ? <Spinner small /> : '✨'} Analyser</button>
        </>
      }
    >
      <p className="muted small">
        Collez la transcription (Teams, dictée…) ou vos notes en vrac. L’assistant rédige le compte rendu dans le journal et propose les tâches, jalons et risques à
        ajouter : rien n’est ajouté au projet sans votre validation. La transcription brute est conservée avec le compte rendu.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Titre <span className="muted">(facultatif)</span></span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Point hebdo avec le prestataire" />
        </label>
        <label className="field">
          <span>Date de la réunion</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <textarea className="input transcript" autoFocus value={text} maxLength={MAX_PROJECT_TRANSCRIPT_CHARS} onChange={(e) => setText(e.target.value)} placeholder="Collez ici la transcription ou les notes de la réunion…" />
      <span className="muted small">{text.length.toLocaleString('fr-FR')} caractères</span>
    </Modal>
  );
}
