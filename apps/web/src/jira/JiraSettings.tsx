import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { JIRA_DEMO_SITE, type JiraConfigInfo, type JiraTestResult } from '@samm/shared';
import { api } from '../api';
import { ErrorBox, Spinner, formatDateTime, shortUser, toast } from '../components/ui';

/** Paramétrage → Jira : connexion à Jira Cloud (le jeton reste côté serveur). */
export function JiraSettings() {
  const [conf, setConf] = useState<JiraConfigInfo | null>(null);
  const [test, setTest] = useState<JiraTestResult | null>(null);
  const [f, setF] = useState({ site: '', email: '', token: '', storyPointsField: '', deskRefField: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api.jiraConfig().then(
      (c) => {
        setConf(c);
        setF((x) => ({ ...x, site: c.site, email: c.email, storyPointsField: c.storyPoints?.id ?? '', deskRefField: c.deskRef?.id ?? '' }));
        if (c.configured) api.jiraFields().then(setTest, () => {});
      },
      setError,
    );
  }, []);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const demo = f.site.trim().toLowerCase() === JIRA_DEMO_SITE;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveJiraConfig(f);
      setConf(res.config);
      setTest(res.test);
      setF((x) => ({ ...x, site: res.config.site, token: '', storyPointsField: res.config.storyPoints?.id ?? '', deskRefField: res.config.deskRef?.id ?? '' }));
      toast(`Connexion réussie (${res.test.accountName}).`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!conf && !error) return <Spinner />;
  return (
    <div className="grid-halves">
      <section className="card">
        <h2>Connexion à Jira Cloud</h2>
        {conf?.configured && <p><span className="badge badge-ok">Connecté{conf.accountName && ` : ${conf.accountName}`}</span></p>}
        <ErrorBox error={error} />
        <div className="form-grid">
          <label className="field span-2">
            <span>Site Jira *</span>
            <input className="input" value={f.site} onChange={(e) => set('site', e.target.value)} placeholder="https://monentreprise.atlassian.net" />
          </label>
          {!demo && (
            <>
              <label className="field">
                <span>E-mail du compte *</span>
                <input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} placeholder="compte.service@monentreprise.fr" />
              </label>
              <label className="field">
                <span>Jeton d’API {conf?.tokenHint ? `(enregistré : ${conf.tokenHint})` : '*'}</span>
                <input className="input" type="password" autoComplete="off" value={f.token} onChange={(e) => set('token', e.target.value)} placeholder={conf?.tokenHint ? 'Laisser vide pour le conserver' : ''} />
              </label>
            </>
          )}
          {test && (
            <>
              <label className="field">
                <span>Champ « story points »</span>
                <select className="input" value={f.storyPointsField} onChange={(e) => set('storyPointsField', e.target.value)}>
                  <option value="">Détection automatique</option>
                  {test.fields.filter((x) => x.type === 'number').map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Champ « référence du ticket Desk »</span>
                <select className="input" value={f.deskRefField} onChange={(e) => set('deskRefField', e.target.value)}>
                  <option value="">Détection automatique</option>
                  {test.fields.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
        <div className="actions mt">
          <button className="btn btn-primary" disabled={busy || !f.site.trim()} onClick={() => void save()}>
            {busy && <Spinner small />} Tester et enregistrer
          </button>
          {conf?.demoAvailable && !demo && (
            <button className="btn btn-ghost" disabled={busy} onClick={() => setF((x) => ({ ...x, site: JIRA_DEMO_SITE }))}>Utiliser le Jira de démonstration</button>
          )}
        </div>
        {conf?.updatedAt && <p className="muted small">Modifié le {formatDateTime(conf.updatedAt)} par {shortUser(conf.updatedBy ?? '')}.</p>}
        {conf?.configured && (
          <p className="small">
            Story points : <strong>{conf.storyPoints?.name ?? 'non trouvé'}</strong> · Réf. Desk : <strong>{conf.deskRef?.name ?? 'non trouvé'}</strong>
          </p>
        )}
      </section>
      <section className="card">
        <h2>Mode d’emploi</h2>
        <ol className="small">
          <li>Utilisez de préférence un <strong>compte de service</strong> Jira qui a accès en lecture aux projets suivis.</li>
          <li>
            Connecté avec ce compte, créez un jeton sur{' '}
            <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">id.atlassian.com → Sécurité → Jetons d’API</a>, puis collez-le ici.
          </li>
          <li>Dans le module <Link to="/jira">Jira</Link>, choisissez les tableaux Scrum à suivre, puis importez les tickets et les sprints.</li>
        </ol>
        <p className="muted small">
          Le hub ne fait que <strong>lire</strong> Jira : sprints, tickets (résumé, statut, personne assignée, story points, échéance, parent) et leur historique. Le jeton
          est conservé côté serveur et n’est jamais renvoyé au navigateur. Les descriptions et commentaires des tickets ne sont pas lus.
        </p>
        {conf?.demoAvailable && (
          <p className="muted small">En local, le site « demo » donne accès à un projet Jira fictif (TC) pour essayer le module sans compte Jira.</p>
        )}
      </section>
    </div>
  );
}
