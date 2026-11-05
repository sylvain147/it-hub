import { useState } from 'react';
import { CONTACT_ROLE_SUGGESTIONS, type Contact } from '@samm/shared';
import { EmptyState, toast } from '../components/ui';
import { DataList, ItemModal, useItemActions, useProject } from './common';
import { initials } from './OverviewTab';

export function ContactsTab() {
  const { project } = useProject();
  const actions = useItemActions();
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const contacts = project.items.contacts;
  // Regroupement par organisation (interne, prestataires…).
  const groups = [...new Set(contacts.map((c) => c.organisation.trim() || 'Sans organisation'))].sort((a, b) => a.localeCompare(b, 'fr'));
  const emails = contacts.map((c) => c.email).filter(Boolean);

  return (
    <div>
      <div className="toolbar-row">
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Ajouter un intervenant</button>
        {emails.length > 1 && (
          <>
            <a className="btn" href={`mailto:${emails.join(',')}?subject=${encodeURIComponent(`[${project.code || project.name}] `)}`}>✉️ Écrire à tous</a>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(emails.join('; '));
                toast('Adresses copiées.');
              }}
            >
              Copier les adresses
            </button>
          </>
        )}
      </div>
      {contacts.length === 0 ? (
        <EmptyState>Aucun intervenant. Ajoutez le sponsor, les référents métier, les interlocuteurs chez les prestataires…</EmptyState>
      ) : (
        groups.map((g) => (
          <div key={g}>
            <h3 className="section-h">{g}</h3>
            <div className="contact-grid">
              {contacts
                .filter((c) => (c.organisation.trim() || 'Sans organisation') === g)
                .map((c) => (
                  <div key={c.id} className="contact-card" onClick={() => setEditing(c)}>
                    <span className="avatar">{initials(c.name)}</span>
                    <div className="contact-body">
                      <div className="strong">{c.name}</div>
                      {c.role && <div className="muted small">{c.role}</div>}
                      {c.email && <a href={`mailto:${c.email}`} onClick={(e) => e.stopPropagation()} className="small">{c.email}</a>}
                      {c.phone && <a href={`tel:${c.phone.replace(/\s/g, '')}`} onClick={(e) => e.stopPropagation()} className="small">{c.phone}</a>}
                      {c.notes && <div className="muted small clamp">{c.notes}</div>}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))
      )}
      {editing && (
        <ContactDialog
          contact={editing === 'new' ? null : editing}
          organisations={[...contacts.map((c) => c.organisation), ...project.stats.prestataires]}
          onClose={() => setEditing(null)}
          onDelete={(c) => void actions.remove('contacts', c.id, c.name).then((ok) => ok && setEditing(null))}
        />
      )}
    </div>
  );
}

function ContactDialog({ contact, organisations, onClose, onDelete }: { contact: Contact | null; organisations: string[]; onClose: () => void; onDelete: (c: Contact) => void }) {
  const actions = useItemActions();
  const [f, setF] = useState({
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    organisation: contact?.organisation ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    notes: contact?.notes ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  return (
    <ItemModal
      title={contact ? 'Intervenant' : 'Nouvel intervenant'}
      onClose={onClose}
      canSave={!!f.name.trim()}
      onSave={() => actions.save('contacts', contact?.id ?? null, f)}
      extraFooter={contact && <button className="btn btn-danger-ghost" onClick={() => onDelete(contact)}>Supprimer</button>}
    >
      <label className="field">
        <span>Nom *</span>
        <input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      <label className="field">
        <span>Rôle</span>
        <input className="input" list="roles" value={f.role} onChange={(e) => set('role', e.target.value)} />
        <DataList id="roles" values={CONTACT_ROLE_SUGGESTIONS} />
      </label>
      <label className="field">
        <span>Organisation</span>
        <input className="input" list="orgs" value={f.organisation} onChange={(e) => set('organisation', e.target.value)} placeholder="ex. DSI, Coqliqo, Logistique" />
        <DataList id="orgs" values={organisations} />
      </label>
      <label className="field">
        <span>E-mail</span>
        <input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
      </label>
      <label className="field">
        <span>Téléphone</span>
        <input className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
      </label>
      <label className="field span-2">
        <span>Notes</span>
        <textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Disponibilités, périmètre, suppléant…" />
      </label>
    </ItemModal>
  );
}
