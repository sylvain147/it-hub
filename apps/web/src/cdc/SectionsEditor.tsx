import { emptyDoc, sectionNumbers, type CdcDocument, type Section } from '@samm/shared';
import { RichEditor } from '../editor/RichEditor';

const newSectionId = () => Math.random().toString(16).slice(2, 12);

interface Props {
  doc: CdcDocument;
  onChange: (d: CdcDocument) => void;
  editable: boolean;
  cdcId: string;
  /** Change quand le contenu est rechargé depuis le serveur (force la réinitialisation des éditeurs). */
  docKey: number;
  aiDisabledReason: string | null;
  onRework: (s: Section) => void;
}

export function SectionsEditor({ doc, onChange, editable, cdcId, docKey, aiDisabledReason, onRework }: Props) {
  const numbers = sectionNumbers(doc.sections);
  const setSections = (sections: Section[]) => onChange({ ...doc, sections });
  const update = (id: string, patch: Partial<Section>) => setSections(doc.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const hasAnnexes = doc.sections.some((s) => s.kind === 'annexes');

  function move(idx: number, delta: number) {
    const target = idx + delta;
    const list = [...doc.sections];
    if (list[target]?.kind !== 'standard') return; // Contexte reste en premier, Annexes en dernier
    [list[idx], list[target]] = [list[target]!, list[idx]!];
    setSections(list);
  }

  function addSection() {
    const s: Section = { id: newSectionId(), kind: 'standard', title: 'Nouvelle section', content: emptyDoc() };
    const list = [...doc.sections];
    const annexIdx = list.findIndex((x) => x.kind === 'annexes');
    list.splice(annexIdx >= 0 ? annexIdx : list.length, 0, s);
    setSections(list);
  }

  function remove(s: Section) {
    if (!confirm(`Supprimer la section « ${s.title} » ? (Elle restera consultable dans l’historique des versions.)`)) return;
    setSections(doc.sections.filter((x) => x.id !== s.id));
  }

  return (
    <div className="sections">
      {doc.sections.map((s, idx) => (
        <section key={s.id} className={`card section section-${s.kind}`}>
          <div className="section-head">
            <span className="section-num">{numbers[idx] != null ? `${numbers[idx]}.` : ''}</span>
            {s.kind === 'contexte' ? (
              <h2 className="section-title-fixed">Contexte</h2>
            ) : (
              <input className="section-title" value={s.title} disabled={!editable} onChange={(e) => update(s.id, { title: e.target.value })} aria-label="Titre de la section" />
            )}
            <div className="section-actions">
              {editable && s.kind === 'standard' && (
                <>
                  <button className="btn-icon" title="Monter" disabled={doc.sections[idx - 1]?.kind !== 'standard'} onClick={() => move(idx, -1)}>↑</button>
                  <button className="btn-icon" title="Descendre" disabled={doc.sections[idx + 1]?.kind !== 'standard'} onClick={() => move(idx, 1)}>↓</button>
                </>
              )}
              <button className="btn btn-sm btn-ai" disabled={!!aiDisabledReason} title={aiDisabledReason ?? 'Demander à l’assistant de retravailler cette section'} onClick={() => onRework(s)}>
                ✨ Retravailler
              </button>
              {editable && s.kind !== 'contexte' && (
                <button className="btn-icon danger" title="Supprimer la section" onClick={() => remove(s)}>🗑</button>
              )}
            </div>
          </div>
          <RichEditor
            key={`${docKey}:${s.id}`}
            value={s.content}
            onChange={(content) => update(s.id, { content })}
            editable={editable}
            cdcId={cdcId}
            sectionNumber={numbers[idx] ?? null}
            placeholder={s.kind === 'contexte' ? 'Décrivez la situation, le déclencheur et les faits clés…' : s.kind === 'annexes' ? 'Listes de référence, tableaux, captures d’écran (collez directement vos images)…' : 'Rédigez ici…'}
          />
        </section>
      ))}
      {editable && (
        <div className="add-section">
          <button className="btn btn-ghost" onClick={addSection}>+ Ajouter une section</button>
          {!hasAnnexes && (
            <button className="btn btn-ghost" onClick={() => setSections([...doc.sections, { id: newSectionId(), kind: 'annexes', title: 'Annexes', content: emptyDoc() }])}>
              + Ajouter des annexes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
