import { z } from 'zod';

/**
 * Outils de chacun : la section « Outils » du menu se compose sur sa fiche (« Ma fiche ») : les outils du hub qu'il
 * veut voir (lecteur de fichiers, suivi TMA…) et ses propres liens (SharePoint, outil du prestataire, ERP…).
 */

export const MAX_TOOL_LINKS = 20;

export const toolLinkSchema = z.object({
  label: z.string().trim().min(1, 'Donnez un nom au lien.').max(60),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((u) => /^https?:\/\/\S+$/i.test(u), 'Adresse invalide (doit commencer par http:// ou https://)'),
  /** Emoji affiché dans le menu. */
  icon: z.string().trim().max(8).default('🔗'),
});
export type ToolLink = z.infer<typeof toolLinkSchema>;

export const userToolsSchema = z.object({
  /** Outils du hub affichés, dans l'ordre choisi (identifiants des modules de la section « Outils »). */
  modules: z
    .array(z.string().trim().min(1).max(40))
    .max(20)
    .transform((ids) => [...new Set(ids)]),
  links: z.array(toolLinkSchema).max(MAX_TOOL_LINKS, `${MAX_TOOL_LINKS} liens au plus.`),
});
export type UserTools = z.infer<typeof userToolsSchema>;

/** Outils d'une fiche : ceux choisis, sinon (jamais réglés) tous les outils du hub, sans lien. */
export function toolsOrDefault(tools: UserTools | null | undefined, allModules: readonly string[]): UserTools {
  return tools ?? { modules: [...allModules], links: [] };
}
