import { useRef, useState } from 'react';
import {
  FILE_CATEGORIES,
  FILE_CATEGORY_LABELS,
  LINK_CATEGORIES,
  LINK_CATEGORY_ICONS,
  LINK_CATEGORY_LABELS,
  MAX_PROJECT_FILE_BYTES,
  type FileCategory,
  type LinkCategory,
  type ProjectFile,
  type ProjectLink,
} from '@samm/shared';
import { api, download } from '../api';
import { EmptyState, Spinner, formatDate, shortUser, toast } from '../components/ui';
import { ItemModal, formatSize, useItemActions, useProject } from './common';

/** Catégorie devinée d'après le nom du fichier. */
function guessCategory(name: string): FileCategory {
  const n = name.toLowerCase();
  if (/devis|quote|offre/.test(n)) return 'devis';
  if (/commande|\bbc\b|purchase/.test(n)) return 'commande';
  if (/spec|cdc|cahier|sfd|sfg|stb/.test(n)) return 'specification';
  if (/\bcr\b|compte.?rendu|minutes/.test(n)) return 'compte_rendu';
  if (/recette|pv|test/.test(n)) return 'recette';
  if (/contrat|contract/.test(n)) return 'contrat';
  return 'autre';
}

function fileIcon(f: ProjectFile) {
  const t = f.contentType;
  if (t.includes('pdf')) return '📕';
  if (t.includes('sheet') || t.includes('excel') || /\.(xlsx?|csv)$/i.test(f.name)) return '📗';
  if (t.includes('word') || /\.docx?$/i.test(f.name)) return '📘';
  if (t.includes('presentation') || /\.pptx?$/i.test(f.name)) return '📙';
  if (t.startsWith('image/')) return '🖼️';
  if (t.includes('zip')) return '🗜️';
  return '📄';
}

export function DocumentsTab() {
  const { project, reload } = useProject();
  const actions = useItemActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [editFile, setEditFile] = useState<ProjectFile | null>(null);
  const [editLink, setEditLink] = useState<ProjectLink | 'new' | null>(null);
  const [cat, setCat] = useState<FileCategory | ''>('');

  const files = project.items.files.filter((f) => f.uploaded && (!cat || f.category === cat));
  const broken = project.items.files.filter((f) => !f.uploaded);

  async function upload(list: File[]) {
    for (const file of list) {
      if (file.size > MAX_PROJECT_FILE_BYTES) {
        toast(`« ${file.name} » dépasse 50 Mo.`, 'error');
        continue;
      }
      if (file.size === 0) continue;
      setUploading((u) => [...u, file.name]);
      try {
        const contentType = file.type || 'application/octet-stream';
        const { file: item, upload } = await api.createProjectFile(project.id, { name: file.name, category: guessCategory(file.name), contentType, size: file.size });
        const res = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: file });
        if (!res.ok) throw new Error(`Échec de l’envoi de « ${file.name} » (${res.status}).`);
        await api.confirmProjectFile(project.id, item.id);
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setUploading((u) => u.filter((n) => n !== file.name));
      }
    }
    await reload();
  }

  async function open(f: ProjectFile) {
    try {
      const { url, fileName } = await api.downloadProjectFile(project.id, f.id);
      download(url, fileName);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const linkGroups = LINK_CATEGORIES.filter((c) => project.items.links.some((l) => l.category === c));

  return (
    <div className="docs">
      <section>
        <div className="toolbar-row">
          <h2 className="no-margin">Documents</h2>
          <span className="tb-flex" />
          <select className="input input-auto" value={cat} onChange={(e) => setCat(e.target.value as FileCategory | '')}>
            <option value="">Toutes les catégories</option>
            {FILE_CATEGORIES.map((c) => <option key={c} value={c}>{FILE_CATEGORY_LABELS[c]}</option>)}
          </select>
        </div>
        <div
          className={`dropzone dropzone-sm${over ? ' dropzone-on' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void upload([...e.dataTransfer.files]);
          }}
        >
          <span className="dropzone-icon">📎</span>
          <strong>Déposez des fichiers ici ou cliquez pour les choisir</strong>
          <span className="muted small">Devis, bons de commande, spécifications, PV de recette… (50 Mo max. par fichier, stockés de façon privée)</span>
          {uploading.length > 0 && (
            <span><Spinner small /> Envoi de {uploading.join(', ')}…</span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void upload([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        {broken.length > 0 && (
          <div className="alert alert-info">
            Envoi interrompu : {broken.map((f) => (
              <span key={f.id} className="nowrap">
                {f.name} <button className="btn-link" onClick={() => actions.remove('files', f.id, f.name)}>retirer</button>{' '}
              </span>
            ))}
          </div>
        )}
        {files.length === 0 ? (
          project.items.files.length > 0 && cat ? <EmptyState>Aucun document dans cette catégorie.</EmptyState> : null
        ) : (
          <div className="table-wrap mt">
            <table className="table table-compact">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Catégorie</th>
                  <th className="num">Taille</th>
                  <th>Déposé</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.id}>
                    <td>
                      <button className="btn-link strong-link" onClick={() => void open(f)} title="Télécharger">{fileIcon(f)} {f.name}</button>
                      {f.notes && <div className="muted small">{f.notes}</div>}
                    </td>
                    <td><span className="badge">{FILE_CATEGORY_LABELS[f.category]}</span></td>
                    <td className="num small">{formatSize(f.size)}</td>
                    <td className="small">{formatDate(f.createdAt.slice(0, 10))} <span className="muted">· {shortUser(f.createdBy)}</span></td>
                    <td className="num nowrap">
                      <button className="btn-icon" title="Modifier" onClick={() => setEditFile(f)}>✏️</button>
                      <button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('files', f.id, f.name)}>🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-lg">
        <div className="toolbar-row">
          <h2 className="no-margin">Liens</h2>
          <button className="btn btn-sm" onClick={() => setEditLink('new')}>+ Ajouter un lien</button>
        </div>
        {project.items.links.length === 0 ? (
          <EmptyState>Aucun lien. Ajoutez le ticket Jira, l’espace SharePoint, le dépôt Git, les environnements de recette…</EmptyState>
        ) : (
          <div className="link-groups">
            {linkGroups.map((c) => (
              <div key={c} className="card card-tight">
                <h3 className="no-margin">{LINK_CATEGORY_ICONS[c]} {LINK_CATEGORY_LABELS[c]}</h3>
                <ul className="list-plain">
                  {project.items.links
                    .filter((l) => l.category === c)
                    .map((l) => (
                      <li key={l.id} className="link-row">
                        <a href={l.url} target="_blank" rel="noreferrer noopener" title={l.url}>{l.label} ↗</a>
                        {l.notes && <span className="muted small">{l.notes}</span>}
                        <span className="tb-flex" />
                        <button className="btn-icon" title="Copier l’adresse" onClick={() => void navigator.clipboard.writeText(l.url).then(() => toast('Adresse copiée.'))}>⧉</button>
                        <button className="btn-icon" title="Modifier" onClick={() => setEditLink(l)}>✏️</button>
                        <button className="btn-icon danger" title="Supprimer" onClick={() => actions.remove('links', l.id, l.label)}>🗑</button>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      {editFile && <FileDialog file={editFile} onClose={() => setEditFile(null)} />}
      {editLink && <LinkDialog link={editLink === 'new' ? null : editLink} onClose={() => setEditLink(null)} />}
    </div>
  );
}

function FileDialog({ file, onClose }: { file: ProjectFile; onClose: () => void }) {
  const actions = useItemActions();
  const [f, setF] = useState({ name: file.name, category: file.category, notes: file.notes });
  return (
    <ItemModal title="Document" onClose={onClose} canSave={!!f.name.trim()} onSave={() => actions.save('files', file.id, f)}>
      <label className="field span-2">
        <span>Nom</span>
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label className="field">
        <span>Catégorie</span>
        <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as FileCategory })}>
          {FILE_CATEGORIES.map((c) => <option key={c} value={c}>{FILE_CATEGORY_LABELS[c]}</option>)}
        </select>
      </label>
      <label className="field span-2">
        <span>Notes</span>
        <textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
    </ItemModal>
  );
}

function LinkDialog({ link, onClose }: { link: ProjectLink | null; onClose: () => void }) {
  const actions = useItemActions();
  const [f, setF] = useState({ label: link?.label ?? '', url: link?.url ?? 'https://', category: link?.category ?? ('autre' as LinkCategory), notes: link?.notes ?? '' });
  const validUrl = /^https?:\/\/\S+\.\S+/i.test(f.url.trim());
  return (
    <ItemModal title={link ? 'Lien' : 'Nouveau lien'} onClose={onClose} canSave={!!f.label.trim() && validUrl} onSave={() => actions.save('links', link?.id ?? null, f)}>
      <label className="field span-2">
        <span>Adresse *</span>
        <input
          className="input"
          autoFocus
          value={f.url}
          onChange={(e) => {
            const url = e.target.value;
            // Catégorie devinée à partir de l'adresse.
            const category: LinkCategory = /jira|glpi|redmine|servicenow/i.test(url)
              ? 'ticket'
              : /git(hub|lab)|bitbucket|azure.*_git/i.test(url)
                ? 'code'
                : /sharepoint|onedrive|drive\.google/i.test(url)
                  ? 'partage'
                  : /confluence|wiki|notion/i.test(url)
                    ? 'documentation'
                    : f.category;
            setF({ ...f, url, category });
          }}
        />
      </label>
      <label className="field">
        <span>Libellé *</span>
        <input className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="ex. Ticket Jira COL-12" />
      </label>
      <label className="field">
        <span>Catégorie</span>
        <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as LinkCategory })}>
          {LINK_CATEGORIES.map((c) => <option key={c} value={c}>{LINK_CATEGORY_ICONS[c]} {LINK_CATEGORY_LABELS[c]}</option>)}
        </select>
      </label>
      <label className="field span-2">
        <span>Notes</span>
        <input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
    </ItemModal>
  );
}
