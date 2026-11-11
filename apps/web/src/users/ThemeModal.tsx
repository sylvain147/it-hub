import { useState } from 'react';
import { THEME_DEFS, THEMES, type ThemeId } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { ErrorBox, Modal, toast } from '../components/ui';
import { applyTheme } from '../theme';

/** Choix du thème de couleur (menu de l'utilisateur) : appliqué tout de suite et retenu sur sa fiche. */
export function ThemeModal({ onClose }: { onClose: () => void }) {
  const { me, reloadMe } = useAuth();
  const [current, setCurrent] = useState<ThemeId>(me.theme);
  const [error, setError] = useState<unknown>(null);

  async function choose(theme: ThemeId) {
    const before = current;
    setCurrent(theme);
    applyTheme(theme);
    setError(null);
    try {
      await api.setPreferences({ theme });
      await reloadMe();
      toast(`Thème « ${THEME_DEFS[theme].label} » enregistré.`);
    } catch (e) {
      setCurrent(before);
      applyTheme(before);
      setError(e);
    }
  }

  return (
    <Modal title="Thème de couleur" onClose={onClose} footer={<><span className="tb-flex" /><button className="btn" onClick={onClose}>Fermer</button></>}>
      <p className="muted small">Le thème ne concerne que vous ; il vous suit sur tous vos postes.</p>
      <ErrorBox error={error} />
      <div className="theme-grid">
        {THEMES.map((id) => {
          const t = THEME_DEFS[id];
          return (
            <button key={id} className={`theme-choice${id === current ? ' on' : ''}`} aria-pressed={id === current} onClick={() => id !== current && void choose(id)}>
              <span className="theme-swatch">
                <span style={{ background: t.colors.navy }} />
                <span style={{ background: t.colors.blue }} />
                <span style={{ background: t.colors.blue50 }} />
              </span>
              <span className="theme-text">
                <strong>{t.label}</strong>
                <span className="small muted">{t.description}</span>
              </span>
              {id === current && <span className="theme-check">✓</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
