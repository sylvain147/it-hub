import { THEME_DEFS, themeOrDefault, type ThemeId } from '@samm/shared';

/** Dernier thème appliqué sur ce poste : évite un flash de couleur (et colore la page de connexion) avant le chargement de l'utilisateur. */
const THEME_KEY = 'hub.theme';

/** Applique un thème : ses couleurs remplacent les variables CSS d'accent (voir `:root` dans styles.css). */
export function applyTheme(id: string | null | undefined) {
  const theme = themeOrDefault(id);
  const { navy, navy2, blue, blue50 } = THEME_DEFS[theme].colors;
  const s = document.documentElement.style;
  s.setProperty('--navy', navy);
  s.setProperty('--navy-2', navy2);
  s.setProperty('--blue', blue);
  s.setProperty('--blue-50', blue50);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', navy);
  localStorage.setItem(THEME_KEY, theme);
}

export function applyStoredTheme() {
  applyTheme(localStorage.getItem(THEME_KEY));
}

export type { ThemeId };
