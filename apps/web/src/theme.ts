import { useSyncExternalStore } from 'react';
import { THEME_DEFS, themeAssistant, themeOrDefault, type AssistantPersona, type ThemeId } from '@samm/shared';

/** Dernier thème appliqué sur ce poste : évite un flash de couleur (et colore la page de connexion) avant le chargement de l'utilisateur. */
const THEME_KEY = 'hub.theme';
/** Logo par défaut (thèmes sans logo à eux). */
export const DEFAULT_LOGO = '/hobbit.png';
const DEFAULT_ICON = '/favicon.png';
const CHANGED = 'hobbit:theme';

/** Applique un thème : ses couleurs remplacent les variables CSS d'accent (voir `:root` dans styles.css). */
export function applyTheme(id: string | null | undefined) {
  const theme = themeOrDefault(id);
  const { colors, logo, shadow } = THEME_DEFS[theme];
  // Thème sombre (Nazgûl) : la page entière est inversée, on pose donc les couleurs inverses de celles voulues.
  const c = shadow ? { navy: invertHex(colors.navy), navy2: invertHex(colors.navy2), blue: invertHex(colors.blue), blue50: invertHex(colors.blue50) } : colors;
  const { navy, navy2, blue, blue50 } = c;
  const s = document.documentElement.style;
  s.setProperty('--navy', navy);
  s.setProperty('--navy-2', navy2);
  s.setProperty('--blue', blue);
  s.setProperty('--blue-50', blue50);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.navy);
  document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.setAttribute('href', logo ?? DEFAULT_ICON);
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new Event(CHANGED));
}

/** Couleur inverse (#rrggbb). */
function invertHex(hex: string): string {
  const n = 0xffffff - parseInt(hex.slice(1), 16);
  return `#${n.toString(16).padStart(6, '0')}`;
}

function subscribe(cb: () => void) {
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

/** Thème appliqué (suit les changements). */
export function useAppliedTheme(): ThemeId {
  return useSyncExternalStore(subscribe, () => themeOrDefault(document.documentElement.dataset.theme));
}

/** Assistant du thème appliqué : Gandalf, ou Saroumane sous le thème Mordor. */
export function useAssistant(): AssistantPersona {
  return themeAssistant(useAppliedTheme());
}

export function applyStoredTheme() {
  applyTheme(localStorage.getItem(THEME_KEY));
}

export type { ThemeId };
