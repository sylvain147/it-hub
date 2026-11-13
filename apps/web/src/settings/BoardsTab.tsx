import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  CARD_COLORS,
  CARD_COLOR_LABELS,
  CARD_RULE_DAYS,
  CARD_RULE_KINDS,
  CARD_RULE_LABELS,
  CARD_RULE_VALUE,
  DEFAULT_BOARD_ID,
  MAX_CARD_RULES,
  type Board,
  type CardRule,
  type CardRuleKind,
} from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { Spinner, toast } from '../components/ui';
import { UserSelect } from '../users/context';
import { boardsChanged, useBoards } from '../sprints/boards';
import { useSettings } from './context';

function move<T>(xs: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

async function attempt<T>(fn: () => Promise<T>, done?: string): Promise<T | null> {
  try {
    const r = await fn();
    if (done) toast(done);
    boardsChanged();
    return r;
  } catch (e) {
    toast((e as Error).message, 'error');
    return null;
  }
}

/**
 * Onglet « Tableaux » du paramétrage : les tableaux de tickets (créés, renommés et supprimés par les administrateurs,
 * droit `manageBoards`) et, pour chacun, les règles d'affichage des cartes de son sprint en cours (toute l'équipe).
 */
export function BoardsTab() {
  const { me } = useAuth();
  const boards = useBoards();
  const [params, setParams] = useSearchParams();
  const selected = boards?.find((b) => b.id === params.get('tableau')) ?? boards?.[0] ?? null;
  const select = (id: string) => setParams({ onglet: 'tableau', tableau: id }, { replace: true });
  const [newName, setNewName] = useState('');
  const admin = me.permissions.manageBoards;

  async function create() {
    const b = await attempt(() => api.createBoard({ name: newName }), `Tableau « ${newName.trim()} » créé.`);
    if (b) {
      setNewName('');
      select(b.id);
    }
  }
  async function rename(b: Board) {
    const name = prompt('Nouveau nom du tableau', b.name)?.trim();
    if (name && name !== b.name) await attempt(() => api.renameBoard(b.id, { name }), 'Tableau renommé.');
  }
  async function remove(b: Board) {
    if (!confirm(`Supprimer le tableau « ${b.name} » ?`)) return;
    if ((await attempt(() => api.deleteBoard(b.id), 'Tableau supprimé.')) !== null) select(DEFAULT_BOARD_ID);
  }

  if (!boards) return <Spinner />;
  return (
    <>
      <p className="muted small">
        Chaque tableau a ses sprints (un seul en cours à la fois), son backlog et ses règles d’affichage. Chacun choisit son tableau par défaut sur sa fiche : les
        tickets qu’il crée y vont, sauf s’il les crée depuis la page d’un autre tableau. {admin ? '' : 'Seuls les administrateurs créent ou suppriment un tableau.'}
      </p>
      <section className="card">
        <div className="board-switch">
          {boards.map((b) => (
            <button key={b.id} className={b.id === selected?.id ? 'idea-chip on' : 'idea-chip'} aria-pressed={b.id === selected?.id} onClick={() => select(b.id)}>
              {b.name}
            </button>
          ))}
        </div>
        {admin && (
          <div className="toolbar-row mt">
            <input className="input input-auto" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newName.trim() && void create()} placeholder="Nom du nouveau tableau" aria-label="Nom du nouveau tableau" maxLength={60} />
            <button className="btn btn-sm btn-primary" disabled={!newName.trim()} onClick={() => void create()}>+ Nouveau tableau</button>
            {selected && <button className="btn btn-sm btn-ghost" onClick={() => void rename(selected)}>Renommer « {selected.name} »</button>}
            {selected && selected.id !== DEFAULT_BOARD_ID && <button className="btn btn-sm btn-danger-ghost" onClick={() => void remove(selected)}>Supprimer</button>}
          </div>
        )}
      </section>
      {selected && <CardRulesEditor key={selected.id} board={selected} />}
    </>
  );
}

/** Fonds conditionnels des cartes du tableau du sprint en cours : la première règle qui correspond donne la couleur. */
function CardRulesEditor({ board }: { board: Board }) {
  const { lists } = useSettings();
  const projects = useLoad(() => api.listProjects(), []);
  const [rules, setRules] = useState<CardRule[]>(board.cardRules);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRules(board.cardRules), [board.cardRules]);
  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(board.cardRules), [rules, board.cardRules]);
  const update = (i: number, patch: Partial<CardRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const changeKind = (i: number, kind: CardRuleKind) => update(i, { kind, value: '', days: kind === 'echeance' ? 3 : kind === 'immobile' ? 5 : 0 });
  async function save() {
    setSaving(true);
    await attempt(() => api.setBoardRules(board.id, { cardRules: rules }), 'Règles d’affichage enregistrées.');
    setSaving(false);
  }

  return (
    <>
      <h2 className="page-section">Règles d’affichage — {board.name}</h2>
      <p className="muted small">
        Colorez le fond des cartes du tableau du sprint en cours selon une condition. Les règles s’appliquent dans l’ordre : la première qui correspond au ticket donne
        la couleur. Elles valent pour toute l’équipe, sur ce tableau seulement.
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
              {r.kind === 'type' && (
                <select className="input input-sm input-auto" value={r.value} onChange={(e) => update(i, { value: e.target.value })} aria-label="Type de ticket">
                  <option value="">Choisir un type…</option>
                  {[...new Set([...lists.ticketTypes, r.value].filter(Boolean))].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
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
      <div className="actions settings-save">
        {dirty && <button className="btn" onClick={() => setRules(board.cardRules)}>Annuler les modifications</button>}
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving && <Spinner small />} Enregistrer
        </button>
      </div>
    </>
  );
}
