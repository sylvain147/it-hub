import { useState } from 'react';
import { diffWords } from 'diff';
import {
  CDC_STATUS_LABELS,
  PROJECT_PHASE_LABELS,
  VERSION_ORIGIN_LABELS,
  docToMarkdown,
  type CdcDetail,
  type CdcDocument,
  type CdcMeta,
  type VersionInfo,
} from '@samm/shared';
import { api, download } from '../api';
import { useLoad } from '../hooks';
import { EmptyState, Modal, Spinner, formatDate, formatDateTime, shortUser, toast } from '../components/ui';

interface Props {
  detail: CdcDetail;
  refreshKey: number;
  restoreDisabledReason: string | null;
  onRestored: (d: CdcDetail) => void;
}

export function VersionsPanel({ detail, refreshKey, restoreDisabledReason, onRestored }: Props) {
  const { data: versions, loading } = useLoad(() => api.listVersions(detail.id), [detail.id, refreshKey]);
  const [viewing, setViewing] = useState<VersionInfo | null>(null);

  return (
    <div className="panel-body">
      <p className="muted small">
        Chaque enregistrement crée une version. Le passage au statut « Validé » ou « Envoyé au prestataire » crée une version majeure (1.0, 2.0…).
      </p>
      {loading && !versions ? (
        <Spinner />
      ) : !versions?.length ? (
        <EmptyState>Aucune version.</EmptyState>
      ) : (
        <ol className="versions">
          {versions.map((v) => (
            <li key={v.seq} className={v.seq === detail.currentVersion.seq ? 'version current' : 'version'}>
              <div className="version-head">
                <strong>v{v.label}</strong>
                <span className={`badge origin-${v.origin}`}>{VERSION_ORIGIN_LABELS[v.origin]}</span>
                {v.seq === detail.currentVersion.seq && <span className="badge">actuelle</span>}
              </div>
              <div className="muted small">{formatDateTime(v.createdAt)} · {shortUser(v.author)}</div>
              {v.comment && <div className="small">{v.comment}</div>}
              {v.seq !== detail.currentVersion.seq && (
                <button className="btn-link small" onClick={() => setViewing(v)}>Comparer avec la version actuelle</button>
              )}
            </li>
          ))}
        </ol>
      )}
      {viewing && (
        <VersionModal
          detail={detail}
          version={viewing}
          restoreDisabledReason={restoreDisabledReason}
          onClose={() => setViewing(null)}
          onRestored={(d) => {
            setViewing(null);
            onRestored(d);
          }}
        />
      )}
    </div>
  );
}

function VersionModal({
  detail,
  version,
  restoreDisabledReason,
  onClose,
  onRestored,
}: {
  detail: CdcDetail;
  version: VersionInfo;
  restoreDisabledReason: string | null;
  onClose: () => void;
  onRestored: (d: CdcDetail) => void;
}) {
  const { data, loading } = useLoad(() => api.getVersion(detail.id, version.seq), [detail.id, version.seq]);
  const [busy, setBusy] = useState(false);

  async function restore() {
    if (!confirm(`Restaurer la version ${version.label} ? Une nouvelle version sera créée ; rien n’est perdu.`)) return;
    setBusy(true);
    try {
      const res = await api.restoreVersion(detail.id, version.seq, detail.currentVersion.seq);
      toast(`Version ${version.label} restaurée (nouvelle version ${res.version.label}).`);
      onRestored(res.detail);
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  async function exportVersion(format: 'docx' | 'pdf') {
    try {
      const res = await api.exportCdc(detail.id, { format, lang: 'fr', seq: version.seq });
      download(res.url, res.fileName);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <Modal
      title={`Version ${version.label} → version actuelle ${detail.currentVersion.label}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={() => exportVersion('docx')}>Word de la v{version.label}</button>
          <button className="btn" onClick={() => exportVersion('pdf')}>PDF de la v{version.label}</button>
          <span className="tb-flex" />
          <button className="btn btn-primary" disabled={busy || !!restoreDisabledReason} title={restoreDisabledReason ?? ''} onClick={restore}>
            Restaurer la version {version.label}
          </button>
        </>
      }
    >
      <p className="muted small">
        <span className="diff-del">Texte retiré</span> depuis la v{version.label} · <span className="diff-ins">texte ajouté</span> dans la version actuelle.
      </p>
      {loading || !data ? <Spinner /> : <DocDiff before={data.document} after={detail.document} />}
    </Modal>
  );
}

function metaLines(m: CdcMeta): [string, string][] {
  return [
    ['Titre', m.title],
    ['Statut', CDC_STATUS_LABELS[m.status]],
    ['Phase', m.phase ? PROJECT_PHASE_LABELS[m.phase] : '—'],
    ['Prestataire', m.prestataire || '—'],
    ['Projet', m.projet || '—'],
    ['Estimation', m.estimationJours != null ? `${m.estimationJours} j/h` : '—'],
    ['Échéances', m.jalons.filter((j) => j.label || j.date).map((j) => `${j.label || 'Échéance'} : ${j.date ? formatDate(j.date) : 'à préciser'}`).join(' ; ') || '—'],
  ];
}

/** Remplace les références techniques des images par un libellé lisible. */
function readable(md: string) {
  return md.replace(/!\[([^\]]*)\]\(asset:[^)]+\)/g, (_m, alt: string) => `[Image${alt ? ' : ' + alt : ''}]`);
}

export function DocDiff({ before, after }: { before: CdcDocument; after: CdcDocument }) {
  const mb = metaLines(before.meta);
  const ma = metaLines(after.meta);
  const metaChanges = ma.filter(([, v], i) => v !== mb[i]![1]).map(([k, v], i) => ({ k, before: mb.find(([kk]) => kk === k)![1], after: v, i }));

  const beforeById = new Map(before.sections.map((s) => [s.id, s]));
  const afterIds = new Set(after.sections.map((s) => s.id));
  const rows = [
    ...after.sections.map((s) => ({ id: s.id, title: s.title, before: beforeById.get(s.id), after: s })),
    ...before.sections.filter((s) => !afterIds.has(s.id)).map((s) => ({ id: s.id, title: s.title, before: s, after: undefined })),
  ];

  let unchanged = 0;
  const blocks = rows.map((r) => {
    const mdBefore = r.before ? readable(docToMarkdown(r.before.content)) : '';
    const mdAfter = r.after ? readable(docToMarkdown(r.after.content)) : '';
    const titleChanged = r.before && r.after && r.before.title !== r.after.title;
    if (mdBefore === mdAfter && !titleChanged && r.before && r.after) {
      unchanged++;
      return null;
    }
    const label = !r.before ? 'Section ajoutée' : !r.after ? 'Section supprimée' : titleChanged ? `Renommée (ancien titre : ${r.before.title})` : 'Modifiée';
    return (
      <div key={r.id} className="diff-section">
        <h4>
          {r.title} <span className="badge">{label}</span>
        </h4>
        <pre className="diff">
          {diffWords(mdBefore, mdAfter).map((part, i) => (
            <span key={i} className={part.added ? 'diff-ins' : part.removed ? 'diff-del' : ''}>
              {part.value}
            </span>
          ))}
        </pre>
      </div>
    );
  });

  return (
    <div>
      {metaChanges.length > 0 && (
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Champ</th>
              <th>Avant</th>
              <th>Maintenant</th>
            </tr>
          </thead>
          <tbody>
            {metaChanges.map((m) => (
              <tr key={m.k}>
                <td>{m.k}</td>
                <td className="diff-del-cell">{m.before}</td>
                <td className="diff-ins-cell">{m.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {blocks}
      {unchanged > 0 && <p className="muted small">{unchanged} section(s) identique(s) non affichée(s).</p>}
      {!metaChanges.length && blocks.every((b) => !b) && <EmptyState>Aucune différence.</EmptyState>}
    </div>
  );
}
