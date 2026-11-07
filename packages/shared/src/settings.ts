import { z } from 'zod';
import { CDC_STATUSES, CDC_STATUS_LABELS } from './cdc.js';
import {
  PRESTA_STATUSES,
  PRESTA_STATUS_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  RISK_STATUSES,
  RISK_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
} from './project.js';
import { cardRuleSchema, MAX_CARD_RULES } from './sprints/cards.js';

/**
 * Paramétrage du hub : référentiel des prestataires (et de leurs contacts), libellés et ordre des statuts,
 * libellés de jalons et rôles proposés à la saisie. Modifiable par tous les utilisateurs.
 *
 * Les statuts gardent leur code (qui porte le comportement de l'application : projet clos, prestation engagée,
 * risque clos…) ; seuls leur libellé, leur ordre et leur visibilité dans les listes se paramètrent.
 */

// ---------------------------------------------------------------------------
// Statuts
// ---------------------------------------------------------------------------

export const STATUS_LISTS = {
  project: { title: 'Projets', keys: PROJECT_STATUSES, labels: PROJECT_STATUS_LABELS as Record<string, string>, locked: ['cadrage'] },
  ticket: { title: 'Tickets (colonnes du sprint)', keys: TICKET_STATUSES, labels: TICKET_STATUS_LABELS as Record<string, string>, locked: ['a_faire', 'termine'] },
  prestation: { title: 'Prestations', keys: PRESTA_STATUSES, labels: PRESTA_STATUS_LABELS as Record<string, string>, locked: ['a_chiffrer'] },
  risk: { title: 'Risques', keys: RISK_STATUSES, labels: RISK_STATUS_LABELS as Record<string, string>, locked: ['ouvert', 'clos'] },
  cdc: { title: 'Cahiers des charges', keys: CDC_STATUSES, labels: CDC_STATUS_LABELS as Record<string, string>, locked: ['brouillon'] },
} as const;
export type StatusListKey = keyof typeof STATUS_LISTS;
export const STATUS_LIST_KEYS = Object.keys(STATUS_LISTS) as StatusListKey[];

/** Rôle des statuts verrouillés (ne peuvent pas être masqués). */
export const LOCKED_STATUS_HINT = 'Utilisé par défaut ou par les calculs de l’application : ne peut pas être masqué.';

export const DEFAULT_JALON_LABELS = [
  'Réception du devis',
  'Commande',
  'Lancement des développements',
  'Livraison en recette',
  'Recette',
  'Mise en production',
  'Fin de garantie',
];

export const DEFAULT_CONTACT_ROLES = [
  'Chef de projet',
  'Sponsor',
  'Référent métier',
  'Utilisateur clé',
  'Chef de projet prestataire',
  'Développeur',
  'Architecte',
  'Exploitation',
  'Sécurité',
  'Achats',
];

const statusSettingSchema = z.object({
  key: z.string().max(40),
  label: z.string().trim().max(60),
  hidden: z.boolean().default(false),
});
export type StatusSetting = z.infer<typeof statusSettingSchema>;

const suggestions = z.array(z.string().trim().min(1).max(200)).max(200);

export const listSettingsSchema = z.object({
  statuses: z.object(Object.fromEntries(STATUS_LIST_KEYS.map((k) => [k, z.array(statusSettingSchema).max(50)])) as Record<StatusListKey, z.ZodArray<typeof statusSettingSchema>>),
  jalonLabels: suggestions,
  contactRoles: suggestions,
  /** Fonds conditionnels des cartes du tableau de sprint, dans l'ordre d'évaluation. */
  cardRules: z.array(cardRuleSchema).max(MAX_CARD_RULES, `${MAX_CARD_RULES} règles au maximum`).default([]),
});
export type ListSettings = z.infer<typeof listSettingsSchema>;

export function defaultListSettings(): ListSettings {
  return {
    statuses: Object.fromEntries(STATUS_LIST_KEYS.map((k) => [k, STATUS_LISTS[k].keys.map((key) => ({ key, label: STATUS_LISTS[k].labels[key]!, hidden: false }))])) as ListSettings['statuses'],
    jalonLabels: [...DEFAULT_JALON_LABELS],
    contactRoles: [...DEFAULT_CONTACT_ROLES],
    cardRules: [],
  };
}

/**
 * Complète et assainit un paramétrage : codes inconnus retirés, statuts manquants ajoutés à la fin,
 * libellé vide remplacé par le libellé d'origine, statuts verrouillés toujours visibles, doublons retirés.
 */
export function normalizeListSettings(raw: Partial<ListSettings> | null | undefined): ListSettings {
  const def = defaultListSettings();
  const statuses = {} as ListSettings['statuses'];
  for (const k of STATUS_LIST_KEYS) {
    const spec = STATUS_LISTS[k];
    const valid = new Set<string>(spec.keys);
    const seen = new Set<string>();
    const list: StatusSetting[] = [];
    for (const s of raw?.statuses?.[k] ?? []) {
      if (!valid.has(s.key) || seen.has(s.key)) continue;
      seen.add(s.key);
      list.push({ key: s.key, label: s.label?.trim() || spec.labels[s.key]!, hidden: !!s.hidden && !(spec.locked as readonly string[]).includes(s.key) });
    }
    for (const d of def.statuses[k]) if (!seen.has(d.key)) list.push(d);
    statuses[k] = list;
  }
  const clean = (xs: string[] | undefined, fallback: string[]) => (xs ? [...new Set(xs.map((x) => x.trim()).filter(Boolean))] : fallback);
  const cardRules = (raw?.cardRules ?? []).flatMap((r) => {
    const ok = cardRuleSchema.safeParse(r);
    return ok.success ? [ok.data] : [];
  });
  return { statuses, jalonLabels: clean(raw?.jalonLabels, def.jalonLabels), contactRoles: clean(raw?.contactRoles, def.contactRoles), cardRules };
}

export function statusLabel(lists: ListSettings, list: StatusListKey, key: string): string {
  return lists.statuses[list].find((s) => s.key === key)?.label ?? STATUS_LISTS[list].labels[key] ?? key;
}

/** Libellés d'une liste, par code. */
export function statusLabels(lists: ListSettings, list: StatusListKey): Record<string, string> {
  return Object.fromEntries(lists.statuses[list].map((s) => [s.key, s.label]));
}

/** Statuts proposés dans une liste déroulante : visibles, dans l'ordre ; la valeur actuelle reste proposée même masquée. */
export function statusOptions(lists: ListSettings, list: StatusListKey, current?: string): StatusSetting[] {
  return lists.statuses[list].filter((s) => !s.hidden || s.key === current);
}

// ---------------------------------------------------------------------------
// Prestataires et contacts
// ---------------------------------------------------------------------------

export const prestataireInputSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(200),
  activite: z.string().max(300).default(''),
  website: z.union([z.literal(''), z.string().trim().max(500).refine((u) => /^https?:\/\/\S+$/i.test(u), 'Adresse invalide (doit commencer par http:// ou https://)')]).default(''),
  notes: z.string().max(5000).default(''),
  /** Faux : archivé, n'est plus proposé à la saisie. */
  active: z.boolean().default(true),
});
export type PrestataireInput = z.input<typeof prestataireInputSchema>;

export const prestataireContactInputSchema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(200),
  role: z.string().max(100).default(''),
  email: z.union([z.literal(''), z.string().trim().email('Adresse e-mail invalide').max(200)]).default(''),
  phone: z.string().max(50).default(''),
  notes: z.string().max(2000).default(''),
  active: z.boolean().default(true),
});
export type PrestataireContactInput = z.input<typeof prestataireContactInputSchema>;

export type PrestataireContact = z.infer<typeof prestataireContactInputSchema> & { id: string };

export interface Prestataire extends z.infer<typeof prestataireInputSchema> {
  id: string;
  contacts: PrestataireContact[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export const mergePrestataireBody = z.object({ intoId: z.string().min(1).max(40) });

export interface SettingsResponse {
  lists: ListSettings;
  prestataires: Prestataire[];
}

/** Utilisation des prestataires dans les projets (page Paramétrage). */
export interface PrestataireUsage {
  /** Nombre de prestations par prestataire. */
  prestations: Record<string, number>;
  /** Noms saisis avant le paramétrage, pas encore rattachés à un prestataire. */
  unlinked: { name: string; prestations: number }[];
}

export function activePrestataires(list: Prestataire[]): Prestataire[] {
  return list.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Clé de comparaison d'un nom (« COQLIQO SAS » et « Coqliqo sas » sont identiques). */
export const nameKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
