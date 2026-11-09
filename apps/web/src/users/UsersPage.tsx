import { useState } from 'react';
import { PERIMETERS, PERIMETER_LABELS, ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type HubUser, type Perimeter, type Role } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { runtimeConfig } from '../config';
import { EmptyState, ErrorBox, Modal, Spinner, formatDateTime, toast } from '../components/ui';
import { UserSelect, useUsers } from './context';

/** Gestion des utilisateurs (administrateurs). */
export function UsersPage() {
  const { me } = useAuth();
  const { users, reload, name } = useUsers();
  const [editing, setEditing] = useState<HubUser | 'new' | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  if (!me.permissions.manageUsers) {
    return <div className="page"><EmptyState>Seuls les administrateurs gèrent les utilisateurs.</EmptyState></div>;
  }
  const list = users.filter((u) => showInactive || u.active);
  const inactive = users.filter((u) => !u.active).length;
  const cognito = runtimeConfig().authMode === 'cognito';

  async function resend(u: HubUser) {
    try {
      await api.resendInvitation(u.email);
      toast(`Invitation renvoyée à ${u.email}.`);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Utilisateurs</h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Ajouter un utilisateur</button>
      </div>
      <p className="muted small">
        {cognito
          ? 'Ajouter un utilisateur lui envoie par e-mail un mot de passe temporaire ; à la première connexion, il choisit son mot de passe et active la double authentification.'
          : 'Mode développement : pas d’invitation par e-mail, on se connecte simplement avec l’adresse de l’utilisateur.'}
      </p>
      <section className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>E-mail</th>
                <th>Poste et périmètre</th>
                <th>Backup</th>
                <th>Rôle</th>
                <th>Dernière activité</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.email} className={u.active ? 'row-click' : 'row-click row-done'} onClick={() => setEditing(u)}>
                  <td>
                    <strong>{u.name}</strong> {u.email === me.email && <span className="badge">vous</span>} {!u.active && <span className="badge badge-danger">désactivé</span>}
                  </td>
                  <td className="small">{u.email}</td>
                  <td className="small">
                    {u.jobTitle || <span className="muted">—</span>}
                    {u.perimeters.length > 0 && (
                      <div className="row-actions mt-xs">
                        {u.perimeters.map((p) => <span key={p} className="badge badge-perimeter">{PERIMETER_LABELS[p]}</span>)}
                      </div>
                    )}
                  </td>
                  <td className="small">{u.backupId ? name(u.backupId) : <span className="muted">—</span>}</td>
                  <td><span className={`badge role-${u.role}`}>{ROLE_LABELS[u.role]}</span></td>
                  <td className="small">
                    {u.lastSeenAt ? formatDateTime(u.lastSeenAt) : <span className="muted">{u.invitedAt ? `invité le ${formatDateTime(u.invitedAt)}` : 'jamais connecté'}</span>}
                  </td>
                  <td className="num" onClick={(e) => e.stopPropagation()}>
                    {cognito && u.active && !u.lastSeenAt && <button className="btn btn-sm btn-ghost" onClick={() => void resend(u)}>Renvoyer l’invitation</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {inactive > 0 && (
          <label className="check mt">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Afficher les {inactive} utilisateur(s) désactivé(s)
          </label>
        )}
      </section>
      <section className="card">
        <h2>Rôles</h2>
        <table className="table table-compact">
          <tbody>
            {ROLES.map((r) => (
              <tr key={r}>
                <td className="nowrap"><span className={`badge role-${r}`}>{ROLE_LABELS[r]}</span></td>
                <td className="small">{ROLE_DESCRIPTIONS[r]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Tous les utilisateurs accèdent aux projets, au lecteur de fichiers, au suivi TMA et au paramétrage.</p>
      </section>
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await reload(); }} />}
    </div>
  );
}

function UserForm({ user, onClose, onSaved }: { user: HubUser | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { me, reloadMe } = useAuth();
  const [f, setF] = useState({
    email: user?.email ?? '',
    name: user?.name ?? '',
    role: (user?.role ?? 'membre') as Role,
    active: user?.active ?? true,
    jobTitle: user?.jobTitle ?? '',
    backupId: user?.backupId ?? '',
    perimeters: user?.perimeters ?? ([] as Perimeter[]),
  });
  const { active } = useUsers();
  const profile = { jobTitle: f.jobTitle, backupId: f.backupId, perimeters: f.perimeters };
  const togglePerimeter = (p: Perimeter) =>
    setF((x) => ({ ...x, perimeters: x.perimeters.includes(p) ? x.perimeters.filter((y) => y !== p) : PERIMETERS.filter((y) => y === p || x.perimeters.includes(y)) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const self = user?.email === me.email;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (user) {
        await api.updateUser(user.email, { name: f.name, role: f.role, active: f.active, ...profile });
        toast('Utilisateur enregistré.');
        if (self) await reloadMe();
      } else {
        const r = await api.createUser({ email: f.email, name: f.name, role: f.role, ...profile });
        toast(`${r.user.name} ajouté${r.user.invitedAt ? ' : invitation envoyée par e-mail' : ''}${r.linkedTasks ? ` ; ${r.linkedTasks} tâche(s) rattachée(s)` : ''}.`);
      }
      await onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={user ? user.name : 'Nouvel utilisateur'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={busy || !f.name.trim() || !f.email.trim()} onClick={() => void save()}>
            {busy && <Spinner small />} {user ? 'Enregistrer' : 'Ajouter'}
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <label className="field span-2">
          <span>Adresse e-mail *</span>
          <input className="input" type="email" value={f.email} disabled={!!user} autoFocus={!user} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="prenom.nom@entreprise.fr" />
        </label>
        <label className="field span-2">
          <span>Nom affiché *</span>
          <input className="input" value={f.name} autoFocus={!!user} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Prénom Nom" />
        </label>
        <label className="field">
          <span>Poste</span>
          <input className="input" value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} placeholder="ex. Chef de projet ERP" />
        </label>
        <label className="field">
          <span>Backup</span>
          <UserSelect
            value={f.backupId}
            onChange={(v) => setF({ ...f, backupId: v })}
            allowEmpty
            emptyLabel="Aucun"
            only={active.filter((u) => u.email !== (user?.email ?? f.email.trim().toLowerCase())).map((u) => u.email)}
          />
        </label>
        <div className="field span-2">
          <span>Périmètre</span>
          <div className="perimeter-choices">
            {PERIMETERS.map((p) => (
              <label key={p} className={f.perimeters.includes(p) ? 'choice-chip on' : 'choice-chip'}>
                <input type="checkbox" checked={f.perimeters.includes(p)} onChange={() => togglePerimeter(p)} /> {PERIMETER_LABELS[p]}
              </label>
            ))}
          </div>
        </div>
        <div className="field span-2">
          <span>Rôle</span>
          <div className="role-choices">
            {ROLES.map((r) => (
              <label key={r} className={f.role === r ? 'choice on' : 'choice'}>
                <input type="radio" name="role" checked={f.role === r} onChange={() => setF({ ...f, role: r })} />
                <span>
                  <strong>{ROLE_LABELS[r]}</strong>
                  <span className="muted small">{ROLE_DESCRIPTIONS[r]}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {user && !self && (
          <label className="check span-2">
            <input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> Désactivé (ne peut plus se connecter ; ses tâches et
            son historique sont conservés)
          </label>
        )}
      </div>
    </Modal>
  );
}
