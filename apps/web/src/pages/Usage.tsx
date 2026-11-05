import { useState } from 'react';
import type { UsageBreakdownRow } from '@samm/shared';
import { api } from '../api';
import { useLoad } from '../hooks';
import { ErrorBox, Spinner, formatDateTime, shortUser } from '../components/ui';

const OPERATION_LABELS: Record<string, string> = {
  extraction: 'Tri des transcriptions',
  redaction: 'Rédaction initiale',
  nouvelle_transcription: 'Intégration de transcriptions',
  integration_reponses: 'Intégration des réponses',
  retravail_section: 'Retravail de sections',
  traduction: 'Traductions',
  tma_themes: 'Classement des tickets TMA',
  tma_synthese: 'Synthèses TMA',
  jira_compte_rendu: 'Comptes rendus de sprint',
};

const usd = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })} $`;
const num = (n: number) => n.toLocaleString('fr-FR');

function lastMonths(n: number) {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

export function Usage() {
  const months = lastMonths(12);
  const [month, setMonth] = useState(months[0]!);
  const { data, error, loading } = useLoad(() => api.usage(month), [month]);
  const pct = data ? Math.min(100, (data.totalCostUsd / data.budgetUsd) * 100) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Consommation IA</h1>
        <select className="input input-auto" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>{new Date(m + '-01T00:00:00').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</option>
          ))}
        </select>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Spinner />
      ) : data ? (
        <>
          <div className="stats">
            <div className="stat">
              <div className="stat-label">Coût estimé du mois</div>
              <div className="stat-value">{usd(data.totalCostUsd)}</div>
              <div className={`meter${pct >= 90 ? ' meter-danger' : pct >= 70 ? ' meter-warn' : ''}`}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <div className="muted small">Budget mensuel : {usd(data.budgetUsd)} — au-delà, les fonctions IA sont suspendues jusqu’au mois suivant.</div>
            </div>
            <div className="stat">
              <div className="stat-label">Appels IA</div>
              <div className="stat-value">{num(data.calls)}</div>
            </div>
          </div>
          <p className="muted small">
            Estimation calculée à partir des tokens consommés et des tarifs publics des modèles ; la facture AWS Bedrock fait foi.
          </p>
          <div className="grid-2">
            <Breakdown title="Par opération" rows={data.byOperation} label={(k) => OPERATION_LABELS[k] ?? k} />
            <Breakdown title="Par modèle" rows={data.byModel} label={(k) => k.replace('anthropic.', '')} />
            <Breakdown title="Par utilisateur" rows={data.byUser} label={shortUser} />
          </div>
          <section className="card">
            <h2>Derniers appels</h2>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Opération</th>
                    <th>Modèle</th>
                    <th>Utilisateur</th>
                    <th className="num">Entrée</th>
                    <th className="num">dont cache</th>
                    <th className="num">Sortie</th>
                    <th className="num">Coût</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{formatDateTime(r.at)}</td>
                      <td>{OPERATION_LABELS[r.operation] ?? r.operation}</td>
                      <td>{r.model.replace('anthropic.', '')}</td>
                      <td>{shortUser(r.user)}</td>
                      <td className="num">{num(r.inputTokens + r.cacheReadTokens)}</td>
                      <td className="num">{num(r.cacheReadTokens)}</td>
                      <td className="num">{num(r.outputTokens)}</td>
                      <td className="num">{usd(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Breakdown({ title, rows, label }: { title: string; rows: UsageBreakdownRow[]; label: (k: string) => string }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted small">Aucune donnée.</p>
      ) : (
        <table className="table table-compact">
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{label(r.key)}</td>
                <td className="num muted">{num(r.calls)} appel{r.calls > 1 ? 's' : ''}</td>
                <td className="num">{usd(r.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
