import { useEffect, useState } from 'react';
import type { AiPlan } from '@samm/shared';
import { aiPreview } from '../api';
import { Modal } from '../components/ui';

const ASK = 'hub:ia-recap';
interface Ask {
  plan: AiPlan;
  answer: (ok: boolean) => void;
}

/**
 * Lance un traitement IA après récapitulatif : le hub demande d'abord ce que l'IA va faire (gratuit, aucun appel au
 * modèle), l'affiche, et ne lance `run` que si l'utilisateur confirme. Renvoie null si l'utilisateur annule. Une
 * erreur du récapitulatif (« Tous les tickets sont déjà classés »…) remonte comme celle du lancement.
 */
export async function withAiRecap<T>(run: () => Promise<T>): Promise<T | null> {
  const plan = await aiPreview(run);
  const ok = await new Promise<boolean>((answer) => window.dispatchEvent(new CustomEvent<Ask>(ASK, { detail: { plan, answer } })));
  return ok ? run() : null;
}

const usd = (x: number) => (x < 0.01 ? 'moins d’un centime' : `≈ ${x.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`);
const k = (t: number) => (t >= 1000 ? `${(t / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k` : String(t));

/** Fenêtre « Voici ce que l'IA va faire », montée une fois dans `Layout`. */
export function AiRecapDialog() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    const on = (e: Event) => setAsk((e as CustomEvent<Ask>).detail);
    window.addEventListener(ASK, on);
    return () => window.removeEventListener(ASK, on);
  }, []);
  if (!ask) return null;
  const { plan } = ask;
  const close = (ok: boolean) => {
    ask.answer(ok);
    setAsk(null);
  };
  const left = plan.budget.limitUsd - plan.budget.spentUsd;
  const over = !plan.simulated && plan.estimatedUsd > left;

  return (
    <Modal
      title={`✨ ${plan.title}`}
      onClose={() => close(false)}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>Annuler</button>
          <button className="btn btn-ai" disabled={over} title={over ? 'Le budget IA du mois ne suffit pas' : undefined} onClick={() => close(true)}>✨ Lancer</button>
        </>
      }
    >
      <p className="muted small">Voici ce que l’IA va faire. Rien n’est lancé tant que vous ne cliquez pas sur « Lancer ».</p>
      <h3>Ce que l’IA va faire</h3>
      <ol className="recap-list">
        {plan.steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <h3>Ce qui lui est envoyé</h3>
      <ul className="recap-list">
        {plan.sent.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
      <h3>Ce qui changera</h3>
      <ul className="recap-list">
        {plan.changes.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
      <div className="recap-cost">
        <div>
          <strong>Coût estimé : {plan.simulated ? `aucun (IA simulée ; ${usd(plan.estimatedUsd)} avec l’IA réelle)` : usd(plan.estimatedUsd)}</strong>
          <div className="muted small">
            {plan.calls.map((c) => `${c.count > 1 ? `${c.count} × ` : ''}${c.label} — ${c.model}, ~${k(c.inputTokens)} tokens envoyés, ~${k(c.outputTokens)} attendus`).join(' · ')}
          </div>
        </div>
        <div className="small">
          Budget du mois : {plan.budget.spentUsd.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} $ / {plan.budget.limitUsd} $
          {over && <div className="due-late">Le budget restant ne suffit pas pour ce traitement.</div>}
        </div>
      </div>
      {plan.simulated && <p className="muted small">L’IA n’est pas encore branchée (mode simulé) : le résultat sera un texte d’exemple.</p>}
    </Modal>
  );
}
