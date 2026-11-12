import { z } from 'zod';

/**
 * Validation d'un cahier des charges par d'autres personnes, du hub ou non (adresse e-mail saisie). Chacune reçoit un
 * e-mail avec un lien personnel ; sur la page du lien, elle saisit son adresse, lit le CDC (sans pouvoir le modifier)
 * et le valide ou non, avec un commentaire. La non-validation n'est pas bloquante : elle informe le chargé de projet.
 */

export const REVIEW_DECISIONS = ['valide', 'refuse'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = { valide: 'Validé', refuse: 'Non validé' };

const email = z.string().trim().toLowerCase().email('Adresse e-mail invalide').max(200);

export const MAX_REVIEWERS = 20;

export const requestCdcReviewBody = z.object({
  emails: z
    .array(email)
    .min(1, 'Choisissez au moins une personne.')
    .max(MAX_REVIEWERS, `${MAX_REVIEWERS} personnes au plus.`)
    .transform((xs) => [...new Set(xs)]),
  /** Mot ajouté à l'e-mail et affiché sur la page de validation. */
  message: z.string().trim().max(2000).default(''),
});
export type RequestCdcReviewBody = z.input<typeof requestCdcReviewBody>;

/** Demande de validation, vue par le chargé de projet (onglet « Validations » du CDC). */
export interface CdcReview {
  /** Identifiant (empreinte du lien : le lien lui-même n'est jamais conservé). */
  id: string;
  cdcId: string;
  email: string;
  /** Nom de l'utilisateur du hub ; vide : personne extérieure. */
  name: string;
  /** Version du CDC soumise à validation. */
  versionSeq: number;
  versionLabel: string;
  message: string;
  requestedBy: string;
  requestedAt: string;
  /** E-mail envoyé ; null : pas d'envoi (local, ou échec : voir `sendError`). */
  sentAt: string | null;
  sendError: string;
  decision: ReviewDecision | null;
  comment: string;
  answeredAt: string | null;
}

/** Réponse à une demande : les demandes créées, avec leur lien (montré une fois, à copier si l'e-mail n'est pas parti). */
export interface RequestCdcReviewResult {
  reviews: (CdcReview & { link: string })[];
}

export const openReviewBody = z.object({ email });
export const answerReviewBody = z.object({
  email,
  decision: z.enum(REVIEW_DECISIONS),
  comment: z.string().trim().max(5000).default(''),
});
export type AnswerReviewBody = z.input<typeof answerReviewBody>;

/** Page publique de validation, avant saisie de l'adresse : ce qu'on peut montrer sans rien dévoiler du contenu. */
export interface PublicReviewInfo {
  cdcTitle: string;
  versionLabel: string;
  requestedByName: string;
  requestedAt: string;
  /** Adresse attendue, masquée (« ch***@exemple.fr »). */
  emailHint: string;
}

/** Après saisie de l'adresse : le CDC en lecture seule (sections en Markdown) et la réponse déjà donnée. */
export interface PublicReviewDocument extends PublicReviewInfo {
  message: string;
  projet: string;
  prestataire: string;
  sections: { title: string; markdown: string }[];
  decision: ReviewDecision | null;
  comment: string;
  answeredAt: string | null;
}

/** Adresse masquée : deux premières lettres, puis le domaine. */
export function maskEmail(e: string): string {
  const [user = '', domain = ''] = e.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(3, user.length - 2))}@${domain}`;
}
