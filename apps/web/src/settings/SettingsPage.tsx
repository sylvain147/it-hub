import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  CARD_COLORS,
  CARD_COLOR_LABELS,
  CARD_RULE_DAYS,
  CARD_RULE_KINDS,
  CARD_RULE_LABELS,
  CARD_RULE_VALUE,
  MAX_CARD_RULES,
  type CardRule,
  type CardRuleKind,
  LOCKED_STATUS_HINT,
  STATUS_LISTS,
  STATUS_LIST_KEYS,
  defaultListSettings,
  monthLabel,
  nameKey,
  type ListSettings,
  type Prestataire,
  type PrestataireContact,
  type PrestataireContactInput,
  type PrestataireUsage,
  type TmaPrestataireHours,
  type StatusListKey,
  type Permission,
} from '@samm/shared';
import { api } from '../api';
import { EmptyState, ErrorBox, Modal, Spinner, formatDateTime, shortUser, toast } from '../components/ui';
import { useSettings } from './context';
import { TeamsTab } from './TeamsTab';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { UserSelect } from '../users/context';
import { fmtH } from '../tma/common';

type Tab = 'prestataires' | 'statuts' | 'tableau' | 'listes' | 'teams';
const TABS: { id: Tab; label: string; permission?: Permission }[] = [
  { id: 'prestataires', label: 'Prestataires et contacts' },
  { id: 'statuts', label: 'Statuts' },
  { id: 'tableau', label: 'Tableau des sprints' },
  { id: 'listes', label: 'Jalons et rôles' },
  { id: 'teams', label: 'Teams', permission: 'manageIntegrations' },
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const tabs = TABS.filter((t) => !t.permission || me.permissions[t.permission]);
  const tab = (tabs.find((t) => t.id === params.get('onglet'))?.id ?? 'prestataires') as Tab;
  return (
    <div className="page">
      <div className="page-head">
        <h1>Paramétrage</h1>
      </div>
      <p className="muted small">Référentiels communs à tous les projets. Les modifications s’appliquent immédiatement pour toute l’équipe.</p>
      <div className="tabs tabs-page">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setParams({ onglet: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {tab === 'prestataires' && <PrestatairesTab />}
        {tab === 'statuts' && <StatusesTab />}
        {tab === 'tableau' && <CardRulesTab />}
        {tab === 'listes' && <SuggestionsTab />}
        {tab === 'teams' && <TeamsTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prestataires
// ---------------------------------------------------------------------------

function PrestatairesTab() {
  const { prestataires, reload } = useSettings();
  const [usage, setUsage] = useState<PrestataireUsage | null>(null);
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [importing, setImporting] = useState(false);

  // Temps des relevés TMA par contact et par prestataire.
  const [tmaHours, setTmaHours] = useState<TmaPrestataireHours | null>(null);

  const loadUsage = () => api.settingsUsage().then(setUsage, () => setUsage(null));
  const loadTma = () => api.tmaPrestataires().then(setTmaHours, () => setTmaHours(null));
  useEffect(() => {
    void loadUsage();
    void loadTma();
  }, []);
  const refresh = async () => {
    await Promise.all([reload(), loadUsage(), loadTma()]);
  };

  const list = prestataires.filter((p) => (showArchived || p.active || p.id === selected) && (!q.trim() || nameKey(p.name).includes(nameKey(q))));
  const current = prestataires.find((p) => p.id === selected);

  async function importLegacy() {
    setImporting(true);
    try {
      const r = await api.importPrestataires();
      toast(`${r.created} prestataire(s) créé(s), ${r.linked} prestation(s) rattachée(s).`);
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      {usage && usage.unlinked.length > 0 && (
        <div className="alert alert-info">
          <strong>{usage.unlinked.length} prestataire(s) saisi(s) avant le paramétrage</strong> ne sont pas encore dans la liste :{' '}
          {usage.unlinked.map((u) => `${u.name} (${u.prestations} prestation${u.prestations > 1 ? 's' : ''})`).join(', ')}.
          <div className="mt">
            <button className="btn btn-primary btn-sm" disabled={importing} onClick={() => void importLegacy()}>
              {importing && <Spinner small />} Les ajouter et y rattacher les prestations
            </button>
            <span className="muted small"> Les noms identiques à la casse et aux accents près sont regroupés ; vous pourrez ensuite fusionner les doublons restants.</span>
          </div>
        </div>
      )}
      {tmaHours && tmaHours.unknown.length > 0 && (
        <div className="alert alert-warn">
          <strong>{tmaHours.unknown.length} intervenant(s) des relevés TMA</strong> ne sont dans aucun carnet de contacts, leur temps n’est compté sur aucun
          prestataire : {tmaHours.unknown.map((u) => `${u.person} (${fmtH(u.hours)})`).join(', ')}. Ajoutez-les au carnet de leur prestataire (même nom, dans
          n’importe quel ordre).
        </div>
      )}
      <div className="presta-layout">
        <div>
          <div className="toolbar-row">
            <input className="input" placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
            <button className="btn btn-primary" onClick={() => setSelected('new')}>+ Prestataire</button>
          </div>
          <label className="check small">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Afficher les prestataires archivés
          </label>
          <div className="settings-list mt">
            {!list.length && <EmptyState>Aucun prestataire. Ajoutez vos prestataires pour les choisir dans les projets et les cahiers des charges.</EmptyState>}
            {list.map((p) => (
              <button key={p.id} className={`presta-item${p.id === selected ? ' on' : ''}${p.active ? '' : ' archived'}`} onClick={() => setSelected(p.id)}>
                <span>
                  <span className="strong">{p.name}</span>
                  {!p.active && <span className="badge"> archivé</span>}
                  {p.activite && <div className="muted small">{p.activite}</div>}
                </span>
                <span className="muted small nowrap">
                  {p.contacts.filter((c) => c.active).length} contact(s) · {usage?.prestations[p.id] ?? 0} prestation(s)
                  {tmaHours?.byPrestataire[p.id] && <> · {fmtH(tmaHours.byPrestataire[p.id]!.hours)} TMA</>}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div>
          {selected === 'new' ? (
            <PrestataireForm key="new" prestataire={null} onSaved={async (p) => { await refresh(); setSelected(p.id); }} />
          ) : current ? (
            <>
              <PrestataireForm key={current.id} prestataire={current} usage={usage?.prestations[current.id] ?? 0} onSaved={refresh} onRemoved={async () => { await refresh(); setSelected(null); }} />
              <ContactsBook prestataire={current} tmaHours={tmaHours} onChanged={refresh} />
            </>
          ) : (
            <EmptyState>Choisissez un prestataire pour modifier sa fiche et son carnet de contacts.</EmptyState>
          )}
        </div>
      </div>
    </>
  );
}

function PrestataireForm({ prestataire, usage = 0, onSaved, onRemoved }: { prestataire: Prestataire | null; usage?: number; onSaved: (p: Prestataire) => Promise<void>; onRemoved?: () => Promise<void> }) {
  const { prestataires } = useSettings();
  const [f, setF] = useState({
    name: prestataire?.name ?? '',
    activite: prestataire?.activite ?? '',
    website: prestataire?.website ?? '',
    notes: prestataire?.notes ?? '',
    active: prestataire?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [mergeInto, setMergeInto] = useState('');
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const dirty = !prestataire || (Object.keys(f) as (keyof typeof f)[]).some((k) => f[k] !== prestataire[k]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    run(async () => {
      const p = prestataire ? await api.updatePrestataire(prestataire.id, f) : await api.createPrestataire(f);
      toast(prestataire && prestataire.name !== p.name ? `Renommé : les projets ont été mis à jour.` : 'Enregistré.');
      await onSaved(p);
    });

  const merge = () =>
    run(async () => {
      const into = prestataires.find((p) => p.id === mergeInto);
      if (!prestataire || !into) return;
      if (!confirm(`Fusionner « ${prestataire.name} » dans « ${into.name} » ? Ses prestations, intervenants et contacts passent sur « ${into.name} », puis « ${prestataire.name} » est supprimé.`)) return;
      await api.mergePrestataire(prestataire.id, into.id);
      toast('Prestataires fusionnés.');
      await onRemoved?.();
    });

  const remove = () =>
    run(async () => {
      if (!prestataire || !confirm(`Supprimer « ${prestataire.name} » ?`)) return;
      await api.deletePrestataire(prestataire.id);
      toast('Supprimé.');
      await onRemoved?.();
    });

  return (
    <section className="card">
      <div className="card-head">
        <h2>{prestataire ? prestataire.name : 'Nouveau prestataire'}</h2>
        {prestataire && <span className="muted small">modifié le {formatDateTime(prestataire.updatedAt)} par {shortUser(prestataire.updatedBy)}</span>}
      </div>
      <ErrorBox error={error} />
      <div className="form-grid">
        <label className="field">
          <span>Nom *</span>
          <input className="input" autoFocus={!prestataire} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Activité</span>
          <input className="input" value={f.activite} onChange={(e) => set('activite', e.target.value)} placeholder="ex. TMA de l’ERP, transporteur, éditeur" />
        </label>
        <label className="field span-2">
          <span>Site web</span>
          <input className="input" value={f.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
        </label>
        <label className="field span-2">
          <span>Notes</span>
          <textarea className="input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Contrat, conditions, portail support…" />
        </label>
        {prestataire && (
          <label className="check span-2">
            <input type="checkbox" checked={!f.active} onChange={(e) => set('active', !e.target.checked)} /> Archivé (n’est plus proposé dans les projets ; l’historique est conservé)
          </label>
        )}
      </div>
      <div className="actions mt">
        <button className="btn btn-primary" disabled={!f.name.trim() || !dirty || busy} onClick={() => void save()}>
          {busy && <Spinner small />} {prestataire ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
      {prestataire && (
        <div className="mt-lg">
          <h3>Doublon ?</h3>
          <div className="toolbar-row">
            <select className="input input-auto" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">Fusionner dans…</option>
              {prestataires
                .filter((p) => p.id !== prestataire.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </select>
            <button className="btn" disabled={!mergeInto || busy} onClick={() => void merge()}>Fusionner</button>
            {usage === 0 && (
              <button className="btn btn-danger-ghost" disabled={busy} onClick={() => void remove()}>Supprimer</button>
            )}
          </div>
          {usage > 0 && <p className="muted small">Utilisé dans {usage} prestation(s) : archivez-le plutôt que de le supprimer.</p>}
        </div>
      )}
    </section>
  );
}

function ContactsBook({ prestataire, tmaHours, onChanged }: { prestataire: Prestataire; tmaHours: TmaPrestataireHours | null; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<PrestataireContact | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const contacts = prestataire.contacts.filter((c) => showArchived || c.active);
  const archived = prestataire.contacts.length - prestataire.contacts.filter((c) => c.active).length;
  return (
    <section className="card">
      <div className="card-head">
        <h2>Carnet de contacts</h2>
        <button className="btn btn-sm" onClick={() => setEditing('new')}>+ Contact</button>
      </div>
      <p className="muted small">
        Ces contacts se choisissent comme intervenants dans les projets ; une modification ici se répercute dans tous les projets. Le temps des relevés TMA
        s’ajoute au contact du même nom.
      </p>
      {tmaHours?.byPrestataire[prestataire.id] && (
        <p className="small">
          Temps TMA : <strong>{fmtH(tmaHours.byPrestataire[prestataire.id]!.hours)}</strong>
          <span className="muted"> ({tmaHours.byPrestataire[prestataire.id]!.months.map((m) => `${monthLabel(m.month)} : ${fmtH(m.hours)}`).join(' · ')})</span>
        </p>
      )}
      {!contacts.length ? (
        <p className="muted small">Aucun contact.</p>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôle</th>
                <th>E-mail</th>
                <th>Téléphone</th>
                {tmaHours?.byPrestataire[prestataire.id] && <th className="num">Temps TMA</th>}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className={c.active ? 'row-click' : 'row-click row-done'} onClick={() => setEditing(c)}>
                  <td className="strong">{c.name}</td>
                  <td>{c.role}</td>
                  <td>{c.email}</td>
                  <td className="nowrap">{c.phone}</td>
                  {tmaHours?.byPrestataire[prestataire.id] && (
                    <td className="num" title={tmaHours.byContact[c.id]?.months.map((m) => `${monthLabel(m.month)} : ${fmtH(m.hours)}`).join('\n')}>
                      {tmaHours.byContact[c.id] ? fmtH(tmaHours.byContact[c.id]!.hours) : <span className="muted">—</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {archived > 0 && (
        <label className="check small mt">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Afficher les {archived} contact(s) archivé(s)
        </label>
      )}
      {editing && <ContactForm prestataire={prestataire} contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </section>
  );
}

function ContactForm({ prestataire, contact, onClose, onSaved }: { prestataire: Prestataire; contact: PrestataireContact | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const { lists } = useSettings();
  const [f, setF] = useState<Required<PrestataireContactInput>>({
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    notes: contact?.notes ?? '',
    active: contact?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onSaved();
      toast(done);
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={contact ? contact.name : `Nouveau contact — ${prestataire.name}`}
      onClose={onClose}
      footer={
        <>
          {contact && (
            <button className="btn btn-danger-ghost" disabled={busy} onClick={() => confirm(`Supprimer ${contact.name} du carnet ?`) && void run(() => api.deletePrestataireContact(prestataire.id, contact.id), 'Contact supprimé.')}>
              Supprimer
            </button>
          )}
          <span className="tb-flex" />
          <button className="btn" onClick={onClose}>Annuler</button>
          <button
            className="btn btn-primary"
            disabled={!f.name.trim() || busy}
            onClick={() => void run(() => (contact ? api.updatePrestataireContact(prestataire.id, contact.id, f) : api.addPrestataireContact(prestataire.id, f)), 'Contact enregistré.')}
          >
            {busy && <Spinner small />} Enregistrer
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <label className="field">
          <span>Nom *</span>
          <input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Rôle</span>
          <input className="input" list="book-roles" value={f.role} onChange={(e) => set('role', e.target.value)} />
          <datalist id="book-roles">
            {lists.contactRoles.map((r) => <option key={r} value={r} />)}
          </datalist>
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
          <textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
        {contact && (
          <label className="check span-2">
            <input type="checkbox" checked={!f.active} onChange={(e) => set('active', !e.target.checked)} /> Archivé (n’est plus proposé ; reste affiché dans les projets où il intervient)
          </label>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Statuts et listes de suggestions
// ---------------------------------------------------------------------------

/** Brouillon local du paramétrage des listes, enregistré d'un bloc. */
function useListsDraft() {
  const { lists, reload } = useSettings();
  const [draft, setDraft] = useState<ListSettings>(lists);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(lists), [lists]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(lists), [draft, lists]);
  async function save() {
    setSaving(true);
    try {
      await api.saveLists(draft);
      await reload();
      toast('Paramétrage enregistré.');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }
  const bar = (
    <div className="actions settings-save">
      {dirty && <button className="btn" onClick={() => setDraft(lists)}>Annuler les modifications</button>}
      <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
        {saving && <Spinner small />} Enregistrer
      </button>
    </div>
  );
  return { draft, setDraft, bar };
}

function move<T>(xs: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

function StatusesTab() {
  const { draft, setDraft, bar } = useListsDraft();
  const setList = (k: StatusListKey, list: ListSettings['statuses'][StatusListKey]) => setDraft((d) => ({ ...d, statuses: { ...d.statuses, [k]: list } }));
  return (
    <>
      <p className="muted small">
        Renommez, réordonnez ou masquez les statuts. Un statut masqué n’est plus proposé, mais les éléments qui l’ont déjà le gardent et l’affichent. Le
        fonctionnement (projet clos, prestation engagée, tâche faite…) ne change pas.
      </p>
      <div className="grid-2">
        {STATUS_LIST_KEYS.map((k) => {
          const list = draft.statuses[k];
          const locked = STATUS_LISTS[k].locked as readonly string[];
          return (
            <section key={k} className="card">
              <div className="card-head">
                <h2>{STATUS_LISTS[k].title}</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setList(k, defaultListSettings().statuses[k])}>Valeurs d’origine</button>
              </div>
              <div className="settings-list">
                {list.map((s, i) => (
                  <div key={s.key} className={`settings-row${s.hidden ? ' settings-row-hidden' : ''}`}>
                    <span className="order">
                      <button className="btn-icon" title="Monter" disabled={i === 0} onClick={() => setList(k, move(list, i, -1))}>↑</button>
                      <button className="btn-icon" title="Descendre" disabled={i === list.length - 1} onClick={() => setList(k, move(list, i, 1))}>↓</button>
                    </span>
                    <input
                      className="input input-sm"
                      value={s.label}
                      maxLength={60}
                      placeholder={STATUS_LISTS[k].labels[s.key]}
                      title={`Libellé d’origine : ${STATUS_LISTS[k].labels[s.key]}`}
                      onChange={(e) => setList(k, list.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))}
                    />
                    <label className="check small" title={locked.includes(s.key) ? LOCKED_STATUS_HINT : 'Ne plus proposer ce statut'}>
                      <input
                        type="checkbox"
                        checked={s.hidden}
                        disabled={locked.includes(s.key)}
                        onChange={(e) => setList(k, list.map((x) => (x.key === s.key ? { ...x, hidden: e.target.checked } : x)))}
                      />{' '}
                      Masqué
                    </label>
                    <span className="code-key" title="Code interne">{locked.includes(s.key) ? '🔒' : ''}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      {bar}
    </>
  );
}

/** Fonds conditionnels des cartes du tableau de sprint : la première règle qui correspond donne la couleur. */
function CardRulesTab() {
  const { draft, setDraft, bar } = useListsDraft();
  const projects = useLoad(() => api.listProjects(), []);
  const rules = draft.cardRules;
  const setRules = (cardRules: CardRule[]) => setDraft((d) => ({ ...d, cardRules }));
  const update = (i: number, patch: Partial<CardRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const changeKind = (i: number, kind: CardRuleKind) => update(i, { kind, value: '', days: kind === 'echeance' ? 3 : kind === 'immobile' ? 5 : 0 });
  return (
    <>
      <p className="muted small">
        Colorez le fond des cartes du tableau du sprint en cours selon une condition. Les règles s’appliquent dans l’ordre : la première qui correspond au ticket donne
        la couleur. Elles valent pour toute l’équipe.
      </p>
      <section className="card">
        {!rules.length && <p className="muted small">Aucune règle : les cartes restent blanches.</p>}
        <div className="settings-list">
          {rules.map((r, i) => (
            <div key={i} className="card-rule-row">
              <span className="order">
                <button className="btn-icon" title="Monter" disabled={i === 0} onClick={() => setRules(move(rules, i, -1))}>↑</button>
                <button className="btn-icon" title="Descendre" disabled={i === rules.length - 1} onClick={() => setRules(move(rules, i, 1))}>↓</button>
              </span>
              <select className="input input-sm input-auto" value={r.kind} onChange={(e) => changeKind(i, e.target.value as CardRuleKind)} aria-label="Condition">
                {CARD_RULE_KINDS.map((k) => <option key={k} value={k}>{CARD_RULE_LABELS[k]}</option>)}
              </select>
              {CARD_RULE_DAYS.includes(r.kind) && (
                <label className="small card-rule-days">
                  N =
                  <input className="input input-sm" type="number" min={0} max={365} value={r.days} onChange={(e) => update(i, { days: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })} />
                  jour(s)
                </label>
              )}
              {r.kind === 'projet' && (
                <select className="input input-sm input-auto" value={r.value} onChange={(e) => update(i, { value: e.target.value })} aria-label="Projet">
                  <option value="">Choisir un projet…</option>
                  {(projects.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {r.kind === 'responsable' && <UserSelect className="input input-sm input-auto" value={r.value} onChange={(v) => update(i, { value: v })} allowEmpty emptyLabel="Choisir une personne…" />}
              <span className="tb-flex" />
              <select className={`input input-sm input-auto card-bg-${r.color}`} value={r.color} onChange={(e) => update(i, { color: e.target.value as CardRule['color'] })} aria-label="Couleur">
                {CARD_COLORS.map((c) => <option key={c} value={c}>{CARD_COLOR_LABELS[c]}</option>)}
              </select>
              <button className="btn-icon" title="Supprimer la règle" onClick={() => setRules(rules.filter((_, j) => j !== i))}>✕</button>
              {CARD_RULE_VALUE.includes(r.kind) && !r.value && <span className="small danger-text">Règle ignorée tant que le choix n’est pas fait.</span>}
            </div>
          ))}
        </div>
        <button
          className="btn btn-sm mt"
          disabled={rules.length >= MAX_CARD_RULES}
          onClick={() => setRules([...rules, { kind: 'retard', value: '', days: 0, color: CARD_COLORS[rules.length % CARD_COLORS.length]! }])}
        >
          + Ajouter une règle
        </button>
      </section>
      {bar}
    </>
  );
}

function SuggestionsTab() {
  const { draft, setDraft, bar } = useListsDraft();
  return (
    <>
      <p className="muted small">Valeurs proposées à la saisie ; un texte libre reste toujours possible.</p>
      <div className="grid-2">
        <SuggestionList
          title="Libellés de jalons"
          hint="Proposés dans le planning des projets et les échéances des cahiers des charges."
          values={draft.jalonLabels}
          onChange={(v) => setDraft((d) => ({ ...d, jalonLabels: v }))}
          reset={() => setDraft((d) => ({ ...d, jalonLabels: defaultListSettings().jalonLabels }))}
        />
        <SuggestionList
          title="Rôles des intervenants"
          hint="Proposés pour les intervenants des projets et les contacts des prestataires."
          values={draft.contactRoles}
          onChange={(v) => setDraft((d) => ({ ...d, contactRoles: v }))}
          reset={() => setDraft((d) => ({ ...d, contactRoles: defaultListSettings().contactRoles }))}
        />
        <SuggestionList
          title="Types de tickets"
          hint="Proposés à la création d’un ticket ; le titre commence par le type en majuscules : « [DEV] - Nom du projet »."
          values={draft.ticketTypes}
          onChange={(v) => setDraft((d) => ({ ...d, ticketTypes: v }))}
          reset={() => setDraft((d) => ({ ...d, ticketTypes: defaultListSettings().ticketTypes }))}
        />
      </div>
      {bar}
    </>
  );
}

function SuggestionList({ title, hint, values, onChange, reset }: { title: string; hint: string; values: string[]; onChange: (v: string[]) => void; reset: () => void }) {
  const [adding, setAdding] = useState('');
  const add = () => {
    const v = adding.trim();
    if (v && !values.some((x) => nameKey(x) === nameKey(v))) onChange([...values, v]);
    setAdding('');
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <button className="btn btn-ghost btn-sm" onClick={reset}>Valeurs d’origine</button>
      </div>
      <p className="muted small">{hint}</p>
      <div className="settings-list">
        {values.map((v, i) => (
          <div key={i} className="settings-row">
            <span className="order">
              <button className="btn-icon" title="Monter" disabled={i === 0} onClick={() => onChange(move(values, i, -1))}>↑</button>
              <button className="btn-icon" title="Descendre" disabled={i === values.length - 1} onClick={() => onChange(move(values, i, 1))}>↓</button>
            </span>
            <input className="input input-sm" value={v} maxLength={200} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
            <button className="btn-icon danger" title="Retirer" onClick={() => onChange(values.filter((_, j) => j !== i))}>✕</button>
            <span />
          </div>
        ))}
      </div>
      <div className="picker-row mt">
        <input
          className="input input-sm"
          placeholder="Ajouter…"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="btn btn-sm" disabled={!adding.trim()} onClick={add}>Ajouter</button>
      </div>
    </section>
  );
}
