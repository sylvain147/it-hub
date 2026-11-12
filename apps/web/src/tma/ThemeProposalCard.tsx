import { useMemo, useState } from 'react';
import type { ThemeProposal } from '@samm/shared';
import { api } from '../api';
import { Spinner, formatDateTime, shortUser, toast } from '../components/ui';
import { useAssistant } from '../theme';

/**
 * Classement par thème proposé par l'IA : son plan en clair, puis les tickets regroupés par thème, cochés par défaut.
 * Rien n'est enregistré sur les tickets avant « Appliquer » ; « Tout ignorer » abandonne la proposition.
 */
export function ThemeProposalCard({ proposal, onDone }: { proposal: ThemeProposal; onDone: () => Promise<void> | void }) {
  const assistant = useAssistant();
  const [kept, setKept] = useState(() => new Set(proposal.items.map((it) => it.id)));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, ThemeProposal['items']>();
    for (const it of proposal.items) m.set(it.theme, [...(m.get(it.theme) ?? []), it]);
    return [...m].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'fr'));
  }, [proposal]);

  const toggle = (ids: string[], on: boolean) =>
    setKept((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  async function run(apply: boolean) {
    setBusy(true);
    try {
      if (apply) {
        await api.applyThemeProposal([...kept]);
        toast(`${kept.size} ticket(s) classé(s).`);
      } else {
        await api.discardThemeProposal();
        toast('Proposition ignorée : aucun thème enregistré.');
      }
      await onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="proposal">
      <p className="proposal-plan">
        <img src={assistant.avatar} alt="" className="gandalf-mini" /> {proposal.plan}
      </p>
      <p className="muted small">Proposition du {formatDateTime(proposal.createdAt)} ({shortUser(proposal.createdBy)}). Décochez ce que vous ne voulez pas, puis appliquez.</p>
      <ul className="list-plain proposal-groups">
        {groups.map(([theme, items]) => {
          const on = items.filter((it) => kept.has(it.id)).length;
          return (
            <li key={theme} className="proposal-group">
              <div className="proposal-group-head">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={on === items.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < items.length;
                    }}
                    onChange={(e) => toggle(items.map((it) => it.id), e.target.checked)}
                  />{' '}
                  <strong>{theme}</strong> <span className="muted small">{items.length} ticket{items.length > 1 ? 's' : ''}</span>
                </label>
                <button className="btn-link small" onClick={() => setOpen(open === theme ? null : theme)}>{open === theme ? 'Masquer' : 'Voir les tickets'}</button>
              </div>
              {open === theme && (
                <ul className="list-plain proposal-items">
                  {items.map((it) => (
                    <li key={it.id}>
                      <label className="check">
                        <input type="checkbox" checked={kept.has(it.id)} onChange={(e) => toggle([it.id], e.target.checked)} /> <span className="ticket-key">#{it.id}</span> {it.subject || '(sans sujet)'}
                        {it.category && <span className="muted small"> · {it.category}</span>}
                        {it.previous && it.previous !== it.theme && <span className="small due-late"> · avant : {it.previous}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="actions mt">
        <button className="btn" disabled={busy} onClick={() => void run(false)}>Tout ignorer</button>
        <span className="tb-flex" />
        <button className="btn btn-primary" disabled={busy || !kept.size} onClick={() => void run(true)}>{busy && <Spinner small />} Appliquer ({kept.size} ticket{kept.size > 1 ? 's' : ''})</button>
      </div>
    </div>
  );
}
