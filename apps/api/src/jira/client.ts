/**
 * Client Jira Cloud (API REST v3 et API Agile), authentifié par e-mail + jeton d'API.
 * Lecture seule : le hub ne modifie jamais Jira.
 */
import { JIRA_DEMO_SITE } from '@samm/shared';
import { config } from '../config.js';
import { HttpError } from '../lib/util.js';
import { demoJiraFetch } from './demo.js';

export interface JiraConnection {
  site: string;
  email: string;
  token: string;
}

export type JiraFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

let fetchOverride: JiraFetch | null = null;
/** Tests : remplace les appels réseau. */
export function setJiraFetch(f: JiraFetch | null) {
  fetchOverride = f;
}

const TIMEOUT_MS = 15_000;

export class JiraClient {
  constructor(private conn: JiraConnection) {
    if (conn.site === JIRA_DEMO_SITE && config.runtime === 'aws') throw new HttpError(400, 'Le site de démonstration n’est disponible qu’en local.');
  }

  private fetcher(): JiraFetch {
    if (fetchOverride) return fetchOverride;
    if (this.conn.site === JIRA_DEMO_SITE) return demoJiraFetch;
    return (url, init) => fetch(url, init);
  }

  async request<T>(method: 'GET' | 'POST', path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}): Promise<T> {
    const base = this.conn.site === JIRA_DEMO_SITE ? 'https://demo.atlassian.net' : this.conn.site;
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    let res: Response;
    try {
      res = await this.fetcher()(url.toString(), {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.conn.email}:${this.conn.token}`).toString('base64')}`,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = (e as Error).name === 'TimeoutError';
      throw new HttpError(502, timeout ? 'Jira ne répond pas (délai dépassé). Réessayez dans un instant.' : `Jira injoignable : vérifiez l’adresse du site (${this.conn.site}).`);
    }
    if (res.ok) return (await res.json()) as T;
    const text = await res.text().catch(() => '');
    let detail = '';
    try {
      const j = JSON.parse(text) as { errorMessages?: string[]; message?: string };
      detail = j.errorMessages?.join(' ') || j.message || '';
    } catch {
      /* réponse non JSON */
    }
    if (res.status === 401) throw new HttpError(400, 'Jira refuse la connexion : vérifiez l’e-mail et le jeton d’API (Paramétrage → Jira).');
    if (res.status === 403) throw new HttpError(403, `Accès refusé par Jira${detail ? ` : ${detail}` : ''}. Le compte n’a peut-être pas accès à ce projet.`);
    if (res.status === 404) throw new HttpError(404, `Introuvable dans Jira${detail ? ` : ${detail}` : ''}.`);
    if (res.status === 429) throw new HttpError(503, 'Jira limite le nombre de requêtes : réessayez dans une minute.');
    if (res.status === 400) throw new HttpError(400, `Requête refusée par Jira${detail ? ` : ${detail}` : ''}.`);
    throw new HttpError(502, `Erreur Jira ${res.status}${detail ? ` : ${detail}` : ''}.`);
  }

  get<T>(path: string, query?: Record<string, string | number | undefined>) {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body: unknown) {
    return this.request<T>('POST', path, { body });
  }
}
