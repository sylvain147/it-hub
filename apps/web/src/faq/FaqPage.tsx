import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { byFaqCategory, type FaqEntry } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLoad } from '../hooks';
import { EmptyState, ErrorBox, Spinner, formatDate, toast } from '../components/ui';
import { DataList, ItemModal, MarkdownField, MarkdownView } from '../projects/common';
import { useUsers } from '../users/context';

/** Sans thème : rangées à la fin. */
const NO_CATEGORY = 'Autres questions';
type Filter = { category: string; unanswered: boolean };

/**
 * FAQ de l'équipe : les questions fréquentes et leurs réponses, rangées par thème, avec une recherche.
 * Tout le monde ajoute une entrée (une question peut rester sans réponse, à compléter par qui la connaît) et
 * corrige une réponse ; l'auteur, ou le droit `manageFaq`, supprime. `?entree=<id>` ouvre une entrée.
 */
export function FaqPage() {
  const { email, me } = useAuth();
  const { name } = useUsers();
  const { data, setData, error, loading } = useLoad(() => api.faq(), []);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>({ category: '', unanswered: false });
  const [open, setOpen] = useState<Set<string>>(() => new Set(params.get('entree') ? [params.get('entree')!] : []));
  const [editing, setEditing] = useState<FaqEntry | 'new' | null>(null);

  // Entrée ouverte par un lien (notification Teams) : on la fait défiler jusqu'à l'écran.
  const target = params.get('entree');
  useEffect(() => {
    if (target && data) document.getElementById(`faq-${target}`)?.scrollIntoView({ block: 'center' });
  }, [target, data]);

  const categories = useMemo(() => [...new Set((data ?? []).map((f) => f.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')), [data]);
  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (data ?? [])
      .filter((f) => (!filter.category || f.category === filter.category) && (!filter.unanswered || !f.answer.trim()))
      .filter((f) => words.every((w) => `${f.question} ${f.answer} ${f.category}`.toLowerCase().includes(w)))
      .sort(byFaqCategory);
  }, [data, q, filter]);
  const groups = useMemo(() => {
    const m = new Map<string, FaqEntry[]>();
    for (const f of rows) m.set(f.category || NO_CATEGORY, [...(m.get(f.category || NO_CATEGORY) ?? []), f]);
    return [...m.entries()];
  }, [rows]);
  const unanswered = (data ?? []).filter((f) => !f.answer.trim()).length;

  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  function saved(f: FaqEntry) {
    setData((d) => (d?.some((x) => x.id === f.id) ? d.map((x) => (x.id === f.id ? f : x)) : [...(d ?? []), f]));
    setOpen((s) => new Set(s).add(f.id));
  }
  async function remove(f: FaqEntry) {
    if (!confirm(`Supprimer la question « ${f.question} » ?`)) return;
    try {
      await api.deleteFaq(f.id);
      setData((d) => d && d.filter((x) => x.id !== f.id));
      setEditing(null);
      toast('Entrée supprimée.');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>❓ FAQ</h1>
          <p className="muted">Les questions qui reviennent et leurs réponses. Chacun peut ajouter une question, même sans en connaître la réponse, et compléter celles des autres.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Ajouter une question</button>
        </div>
      </div>

      <div className="idea-filters">
        <input className="input faq-search" type="search" placeholder="Rechercher dans les questions et les réponses…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" autoFocus />
        <div className="idea-domains" role="group" aria-label="Thème">
          <button className={!filter.category && !filter.unanswered ? 'idea-chip on' : 'idea-chip'} onClick={() => setFilter({ category: '', unanswered: false })}>Toutes</button>
          {categories.map((c) => (
            <button key={c} className={filter.category === c ? 'idea-chip on' : 'idea-chip'} onClick={() => setFilter((f) => ({ ...f, category: f.category === c ? '' : c }))}>{c}</button>
          ))}
          {unanswered > 0 && (
            <button className={filter.unanswered ? 'idea-chip on' : 'idea-chip'} onClick={() => setFilter((f) => ({ ...f, unanswered: !f.unanswered }))}>
              Sans réponse <span className="pill pill-muted">{unanswered}</span>
            </button>
          )}
        </div>
      </div>

      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : !rows.length ? (
        <EmptyState>
          {data?.length ? (
            'Aucune question ne correspond. Ajoutez-la : quelqu’un de l’équipe y répondra.'
          ) : (
            <>
              <p>La FAQ est vide pour l’instant.</p>
              <button className="btn btn-primary" onClick={() => setEditing('new')}>Ajouter la première question</button>
            </>
          )}
        </EmptyState>
      ) : (
        groups.map(([category, entries]) => (
          <section key={category} className="faq-group">
            <h2>{category} <span className="muted small">{entries.length}</span></h2>
            <ul className="faq-list">
              {entries.map((f) => {
                const isOpen = open.has(f.id) || searching(q);
                return (
                  <li key={f.id} id={`faq-${f.id}`} className={`faq-item${isOpen ? ' open' : ''}${target === f.id ? ' faq-target' : ''}`}>
                    <button className="faq-question" aria-expanded={isOpen} onClick={() => toggle(f.id)}>
                      <span className="faq-caret">{isOpen ? '▾' : '▸'}</span>
                      <span className="faq-q">{f.question}</span>
                      {!f.answer.trim() && <span className="badge badge-warn">Sans réponse</span>}
                    </button>
                    {isOpen && (
                      <div className="faq-answer">
                        {f.answer.trim() ? <MarkdownView markdown={f.answer} /> : <p className="muted">Personne n’a encore répondu. Vous savez ? <button className="btn-link" onClick={() => setEditing(f)}>Répondre</button></p>}
                        <div className="faq-meta small muted">
                          <span>
                            Ajoutée par {name(f.createdBy)} le {formatDate(f.createdAt.slice(0, 10))}
                            {f.updatedAt !== f.createdAt && <> · modifiée par {name(f.updatedBy)} le {formatDate(f.updatedAt.slice(0, 10))}</>}
                          </span>
                          <span className="tb-flex" />
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => {
                              void navigator.clipboard?.writeText(`${location.origin}/faq?entree=${f.id}`);
                              toast('Lien vers la question copié.');
                            }}
                          >🔗 Lien</button>
                          <button className="btn btn-sm" onClick={() => setEditing(f)}>✏️ Modifier</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {editing && (
        <FaqModal
          entry={editing === 'new' ? null : editing}
          initialQuestion={editing === 'new' ? q.trim() : ''}
          defaultCategory={filter.category}
          categories={categories}
          canDelete={editing !== 'new' && (editing.createdBy === email || me.permissions.manageFaq)}
          onDelete={remove}
          onClose={() => {
            setEditing(null);
            if (target) setParams({}, { replace: true });
          }}
          onSaved={saved}
        />
      )}
    </div>
  );
}

/** Une recherche en cours déplie les réponses. */
const searching = (q: string) => !!q.trim();

function FaqModal({
  entry,
  initialQuestion,
  defaultCategory,
  categories,
  canDelete,
  onDelete,
  onClose,
  onSaved,
}: {
  entry: FaqEntry | null;
  initialQuestion: string;
  defaultCategory: string;
  categories: string[];
  canDelete: boolean;
  onDelete: (f: FaqEntry) => Promise<void>;
  onClose: () => void;
  onSaved: (f: FaqEntry) => void;
}) {
  const [f, setF] = useState({ question: entry?.question ?? initialQuestion, answer: entry?.answer ?? '', category: entry?.category ?? defaultCategory });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const out = entry ? await api.updateFaq(entry.id, f) : await api.createFaq(f);
    onSaved(out);
    toast(entry ? 'Entrée enregistrée.' : f.answer.trim() ? 'Question ajoutée à la FAQ.' : 'Question ajoutée : l’équipe pourra y répondre.');
  }

  return (
    <ItemModal
      title={entry ? 'Question de la FAQ' : 'Nouvelle question'}
      onClose={onClose}
      onSave={save}
      canSave={!!f.question.trim()}
      wide
      extraFooter={entry && canDelete && <button className="btn btn-danger-ghost" onClick={() => void onDelete(entry)}>Supprimer</button>}
    >
      <label className="field span-2">
        <span>Question *</span>
        <input className="input input-title" autoFocus value={f.question} onChange={(e) => set('question', e.target.value)} placeholder="ex. Comment réinitialiser un mot de passe ERP ?" />
      </label>
      <label className="field">
        <span>Thème</span>
        <input className="input" list="faq-categories" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="ex. ERP, Connexion, Teams" />
        <DataList id="faq-categories" values={categories} />
      </label>
      <div className="field span-2">
        <span>Réponse</span>
        <MarkdownField value={f.answer} onChange={(v) => set('answer', v)} placeholder="La réponse, les étapes, les liens utiles… (vide : quelqu’un de l’équipe répondra)" resetKey={entry?.id ?? 'nouvelle'} images />
      </div>
    </ItemModal>
  );
}
