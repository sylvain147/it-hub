import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MAX_TOOL_LINKS, PERIMETERS, PERIMETER_LABELS, ROLE_LABELS, THEME_DEFS, toolLinkSchema, toolsOrDefault, type ToolLink, type UserTools } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Spinner, formatDateTime, toast } from '../components/ui';
import { TOOL_MODULES } from '../modules';
import { ringClass, useRingHolder } from '../anneau/Anneau';
import { UserSelect, useUsers } from './context';
import type { Perimeter } from '@samm/shared';
import { ThemeModal } from './ThemeModal';
import { useBoards, useDefaultBoardId } from '../sprints/boards';

const move = <T,>(xs: T[], i: number, d: -1 | 1): T[] => {
  const next = [...xs];
  [next[i], next[i + d]] = [next[i + d]!, next[i]!];
  return next;
};

/**
 * Ma fiche : qui je suis dans le hub (rôle, poste, backup, périmètres, réglés par un administrateur), mon thème, et
 * la section « Outils » de mon menu, que je compose : outils du hub et liens personnels.
 */
export function MePage() {
  const { me } = useAuth();
  const { name } = useUsers();
  const ring = ringClass(useRingHolder(), me.email);
  const [theme, setTheme] = useState(false);
  const [editing, setEditing] = useState(false);
  const [params] = useSearchParams();

  useEffect(() => {
    if (params.get('onglet') === 'outils') document.getElementById('mes-outils')?.scrollIntoView({ block: 'start' });
  }, [params]);

  return (
    <div className="page">
      <div className="me-head">
        <span className={`avatar avatar-lg${ring}`}>
          {me.name
            .split(/\s+/)
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </span>
        <div>
          <h1>{me.name}</h1>
          <p className="muted">{[me.jobTitle, me.email].filter(Boolean).join(' · ')}</p>
        </div>
      </div>

      {editing ? (
        <ProfileForm onDone={() => setEditing(false)} />
      ) : (
        <section className="card">
          <div className="card-head">
            <h2>Ma fiche</h2>
            <span className="row-actions">
              {me.permissions.manageUsers && (
                <Link to="/utilisateurs" className="small">
                  Gérer les utilisateurs →
                </Link>
              )}
              <button className="btn btn-sm" onClick={() => setEditing(true)}>
                ✏️ Modifier
              </button>
            </span>
          </div>
          <dl className="facts">
            <div>
              <dt>Rôle</dt>
              <dd>{ROLE_LABELS[me.role]}</dd>
            </div>
            <div>
              <dt>Poste</dt>
              <dd>{me.jobTitle || '—'}</dd>
            </div>
            <div>
              <dt>Backup</dt>
              <dd>{me.backupId ? name(me.backupId) : '—'}</dd>
            </div>
            <div>
              <dt>Périmètres</dt>
              <dd>
                {me.perimeters.length
                  ? me.perimeters.map((p) => (
                      <span key={p} className="badge badge-perimeter">
                        {PERIMETER_LABELS[p]}
                      </span>
                    ))
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Thème</dt>
              <dd>
                {THEME_DEFS[me.theme].label}{' '}
                <button className="btn-link small" onClick={() => setTheme(true)}>
                  Changer
                </button>
              </dd>
            </div>
            <DefaultBoard />
            <div>
              <dt>Dans le hub depuis</dt>
              <dd>{formatDateTime(me.createdAt)}</dd>
            </div>
          </dl>
          <p className="muted small">Le rôle et l’accès au hub sont gérés par les administrateurs.</p>
        </section>
      )}

      <ToolsEditor />
      {theme && <ThemeModal onClose={() => setTheme(false)} />}
    </div>
  );
}

/**
 * Mon tableau de tickets par défaut : les tickets que je crée sans tableau précis (onglet d'un projet, Gandalf…) y vont ;
 * créés depuis la page d'un tableau, ils vont dans ce tableau. Affiché seulement s'il y a plusieurs tableaux.
 */
function DefaultBoard() {
  const { me, reloadMe } = useAuth();
  const boards = useBoards();
  const current = useDefaultBoardId(boards);
  const [busy, setBusy] = useState(false);
  if (!boards || boards.length < 2) return null;
  async function choose(defaultBoardId: string) {
    setBusy(true);
    try {
      await api.setPreferences({ defaultBoardId });
      await reloadMe();
      toast(`Vos nouveaux tickets iront dans « ${boards!.find((b) => b.id === defaultBoardId)?.name} ».`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <dt>Tableau de tickets par défaut</dt>
      <dd>
        <select className="input input-sm input-auto" value={current} disabled={busy} onChange={(e) => void choose(e.target.value)} aria-label="Tableau de tickets par défaut" title={me.defaultBoardId ? undefined : 'Pas encore choisi : le tableau principal'}>
          {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </dd>
    </div>
  );
}

/** Mes informations : nom, poste, backup, périmètres (comme dans la liste des utilisateurs, sans le rôle). */
function ProfileForm({ onDone }: { onDone: () => void }) {
  const { me, reloadMe } = useAuth();
  const { active } = useUsers();
  const [f, setF] = useState({
    name: me.name,
    jobTitle: me.jobTitle,
    backupId: me.backupId,
    perimeters: me.perimeters as Perimeter[],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const toggle = (p: Perimeter) =>
    setF((x) => ({
      ...x,
      perimeters: x.perimeters.includes(p) ? x.perimeters.filter((y) => y !== p) : PERIMETERS.filter((y) => y === p || x.perimeters.includes(y)),
    }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.setMyProfile(f);
      await reloadMe();
      toast('Votre fiche est enregistrée.');
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Modifier ma fiche</h2>
      </div>
      <ErrorBox error={error} />
      <div className="form-grid">
        <label className="field span-2">
          <span>Nom affiché *</span>
          <input className="input" value={f.name} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Prénom Nom" />
        </label>
        <label className="field">
          <span>Poste</span>
          <input className="input" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} placeholder="ex. Chef de projet ERP" />
        </label>
        <label className="field">
          <span>
            Backup <span className="muted">(qui me remplace en mon absence)</span>
          </span>
          <UserSelect value={f.backupId} onChange={(v) => setF({ ...f, backupId: v })} allowEmpty emptyLabel="Aucun" only={active.filter((u) => u.email !== me.email).map((u) => u.email)} />
        </label>
        <div className="field span-2">
          <span>Périmètres</span>
          <div className="perimeter-choices">
            {PERIMETERS.map((p) => (
              <label key={p} className={f.perimeters.includes(p) ? 'choice-chip on' : 'choice-chip'}>
                <input type="checkbox" checked={f.perimeters.includes(p)} onChange={() => toggle(p)} /> {PERIMETER_LABELS[p]}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="actions mt">
        <span className="tb-flex" />
        <button className="btn" onClick={onDone}>
          Annuler
        </button>
        <button className="btn btn-primary" disabled={busy || !f.name.trim()} onClick={() => void save()}>
          {busy && <Spinner small />} Enregistrer
        </button>
      </div>
    </section>
  );
}

const emptyLink = (): ToolLink => ({ label: '', url: '', icon: '🔗' });

/** Section « Outils » de mon menu : outils du hub cochés (dans l'ordre) et mes liens. */
function ToolsEditor() {
  const { me, reloadMe } = useAuth();
  const all = TOOL_MODULES.map((m) => m.id);
  const [tools, setTools] = useState<UserTools>(() => toolsOrDefault(me.tools, all));
  const [adding, setAdding] = useState<ToolLink>(emptyLink);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const saved = JSON.stringify(toolsOrDefault(me.tools, all));
  const dirty = JSON.stringify(tools) !== saved;
  // Outils cochés dans leur ordre, puis les autres.
  const ordered = [...tools.modules.flatMap((id) => TOOL_MODULES.filter((m) => m.id === id)), ...TOOL_MODULES.filter((m) => !tools.modules.includes(m.id))];
  const check = toolLinkSchema.safeParse(adding);
  const addError = adding.url.trim() && !check.success ? check.error.issues[0]?.message : '';

  const toggle = (id: string) =>
    setTools((t) => ({
      ...t,
      modules: t.modules.includes(id) ? t.modules.filter((x) => x !== id) : [...t.modules, id],
    }));
  const setLink = (i: number, patch: Partial<ToolLink>) =>
    setTools((t) => ({
      ...t,
      links: t.links.map((l, j) => (j === i ? { ...l, ...patch } : l)),
    }));

  function addLink() {
    if (!check.success) return;
    setTools((t) => ({ ...t, links: [...t.links, check.data] }));
    setAdding(emptyLink());
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.setPreferences({ tools });
      await reloadMe();
      toast('Vos outils sont enregistrés : ils sont dans le menu.');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card" id="mes-outils">
      <div className="card-head">
        <h2>🧰 Mes outils</h2>
      </div>
      <p className="muted small">
        La section « Outils » de votre menu, rien que pour vous : cochez les outils du hub que vous utilisez et ajoutez vos propres liens (SharePoint, outil du prestataire, ERP…).
      </p>
      <ErrorBox error={error} />

      <h3>Outils du hub</h3>
      <ul className="list-plain tool-list">
        {ordered.map((m) => {
          const i = tools.modules.indexOf(m.id);
          return (
            <li key={m.id} className={i < 0 ? 'tool-row off' : 'tool-row'}>
              <label className="check">
                <input type="checkbox" checked={i >= 0} onChange={() => toggle(m.id)} /> <span className="nav-icon">{m.icon}</span> <strong>{m.title}</strong>
              </label>
              <span className="muted small tool-desc">{m.description}</span>
              {i >= 0 && (
                <span className="order">
                  <button
                    className="btn-icon"
                    title="Monter"
                    disabled={i === 0}
                    onClick={() =>
                      setTools((t) => ({
                        ...t,
                        modules: move(t.modules, i, -1),
                      }))
                    }
                  >
                    ↑
                  </button>
                  <button
                    className="btn-icon"
                    title="Descendre"
                    disabled={i === tools.modules.length - 1}
                    onClick={() =>
                      setTools((t) => ({
                        ...t,
                        modules: move(t.modules, i, 1),
                      }))
                    }
                  >
                    ↓
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <h3>Mes liens</h3>
      {tools.links.length === 0 && <p className="muted small">Aucun lien pour l’instant.</p>}
      <ul className="list-plain tool-list">
        {tools.links.map((l, i) => (
          <li key={i} className="tool-link-row">
            <input className="input input-sm tool-icon" value={l.icon} maxLength={8} onChange={(e) => setLink(i, { icon: e.target.value })} aria-label="Emoji" />
            <input className="input input-sm" value={l.label} maxLength={60} onChange={(e) => setLink(i, { label: e.target.value })} aria-label="Nom" />
            <input className="input input-sm" value={l.url} onChange={(e) => setLink(i, { url: e.target.value })} aria-label="Adresse" />
            <span className="order">
              <button className="btn-icon" title="Monter" disabled={i === 0} onClick={() => setTools((t) => ({ ...t, links: move(t.links, i, -1) }))}>
                ↑
              </button>
              <button className="btn-icon" title="Descendre" disabled={i === tools.links.length - 1} onClick={() => setTools((t) => ({ ...t, links: move(t.links, i, 1) }))}>
                ↓
              </button>
              <button
                className="btn-icon danger"
                title="Retirer"
                onClick={() =>
                  setTools((t) => ({
                    ...t,
                    links: t.links.filter((_, j) => j !== i),
                  }))
                }
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
      {tools.links.length < MAX_TOOL_LINKS && (
        <div className="tool-link-row tool-link-add">
          <input className="input input-sm tool-icon" value={adding.icon} maxLength={8} onChange={(e) => setAdding((a) => ({ ...a, icon: e.target.value }))} aria-label="Emoji" />
          <input className="input input-sm" value={adding.label} maxLength={60} onChange={(e) => setAdding((a) => ({ ...a, label: e.target.value }))} placeholder="Nom, ex. SharePoint projets" />
          <input
            className="input input-sm"
            value={adding.url}
            onChange={(e) => setAdding((a) => ({ ...a, url: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && addLink()}
            placeholder="Adresse, ex. https://…"
          />
          <button className="btn btn-sm" disabled={!check.success} onClick={addLink}>
            Ajouter
          </button>
        </div>
      )}
      {addError && <p className="small due-late">{addError}</p>}

      <div className="actions mt">
        <span className="tb-flex" />
        {dirty && (
          <button className="btn" onClick={() => setTools(JSON.parse(saved) as UserTools)}>
            Annuler
          </button>
        )}
        <button className="btn btn-primary" disabled={!dirty || saving || tools.links.some((l) => !toolLinkSchema.safeParse(l).success)} onClick={() => void save()}>
          {saving && <Spinner small />} Enregistrer mes outils
        </button>
      </div>
    </section>
  );
}
