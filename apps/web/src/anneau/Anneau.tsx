import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { ANNEAU_CHANCE, ANNEAU_PAUSE_MIN, type AnneauState, type AnneauTaken } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Modal, toast } from '../components/ui';
import { useUsers } from '../users/context';

/**
 * Petit jeu caché de l'Anneau unique : de temps en temps, au hasard d'un changement de page, un anneau d'or apparaît
 * quelques secondes. Qui clique dessus le prend, même s'il était au doigt d'un autre ; son porteur a un rond doré
 * autour de ses initiales, partout dans le hub. `?anneau` dans l'adresse le fait apparaître à coup sûr (démonstration).
 */

const LAST_KEY = 'hub.anneau.derniere';
/** Durée d'affichage de l'anneau avant qu'il ne reparte. */
const VISIBLE_MS = 20_000;
/** Le porteur est relu de temps en temps : l'Anneau a pu changer de main. */
const REFRESH_MS = 5 * 60_000;
/** Emplacements possibles, à l'écart du contenu principal (et de la bulle de l'assistant). */
const SPOTS = ['an-spot-bas-gauche', 'an-spot-haut-droite', 'an-spot-milieu-droite', 'an-spot-milieu-bas'];

interface AnneauCtx {
  holder: string | null;
  take: () => Promise<AnneauTaken>;
}

const Ctx = createContext<AnneauCtx>({ holder: null, take: () => api.prendreAnneau() });

/** Porteur de l'Anneau, chargé pour toute l'application (menu latéral compris). */
export function AnneauProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AnneauState | null>(null);
  const reload = useCallback(() => {
    api.anneau().then(setState, () => undefined);
  }, []);
  useEffect(() => {
    reload();
    const t = setInterval(reload, REFRESH_MS);
    window.addEventListener('focus', reload);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', reload);
    };
  }, [reload]);
  const take = useCallback(async () => {
    const r = await api.prendreAnneau();
    setState(r);
    return r;
  }, []);
  return <Ctx.Provider value={{ holder: state?.holder ?? null, take }}>{children}</Ctx.Provider>;
}

/** Porteur de l'Anneau (e-mail), null s'il est libre. */
export function useRingHolder(): string | null {
  return useContext(Ctx).holder;
}

/** Classe à ajouter aux initiales d'un utilisateur : rond doré s'il porte l'Anneau. */
export function ringClass(holder: string | null, email: string | null | undefined): string {
  return email && email === holder ? ' has-ring' : '';
}

/** Une chance sur ANNEAU_CHANCE, et pas plus d'une fois par pause. */
function luckyDraw(): boolean {
  const last = Number(localStorage.getItem(LAST_KEY) ?? 0);
  if (Date.now() - last < ANNEAU_PAUSE_MIN * 60_000) return false;
  if (Math.random() * ANNEAU_CHANCE >= 1) return false;
  localStorage.setItem(LAST_KEY, String(Date.now()));
  return true;
}

/** L'anneau qui apparaît au hasard ; jamais pour son porteur (sauf `?anneau`). */
export function AnneauFlottant() {
  const location = useLocation();
  const { me } = useAuth();
  const { holder, take } = useContext(Ctx);
  const [spot, setSpot] = useState<string | null>(null);
  const [taken, setTaken] = useState<AnneauTaken | null>(null);

  // Un tirage au sort à chaque changement de page.
  useEffect(() => {
    const forced = new URLSearchParams(location.search).has('anneau');
    if (!forced && (spot || holder === me.email || !luckyDraw())) return;
    setSpot(SPOTS[Math.floor(Math.random() * SPOTS.length)]!);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!spot) return;
    const t = setTimeout(() => setSpot(null), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [spot]);

  async function click() {
    setSpot(null);
    try {
      setTaken(await take());
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      {spot && (
        <button className={`an-ring ${spot}`} onClick={() => void click()} title="Un anneau…" aria-label="Prendre l’anneau">
          <RingSvg />
        </button>
      )}
      {taken && <Pris taken={taken} onClose={() => setTaken(null)} />}
    </>
  );
}

function Pris({ taken, onClose }: { taken: AnneauTaken; onClose: () => void }) {
  const { me } = useAuth();
  const { name } = useUsers();
  const already = taken.previous === me.email;
  return (
    <Modal title={already ? 'Vous l’avez déjà.' : 'Mon précieux…'} onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Le garder précieusement</button>}>
      <div className="an-scene" aria-hidden="true">
        <RingSvg />
      </div>
      <p className="an-verdict">
        {already
          ? 'L’Anneau est déjà à votre doigt. Il vous a trouvé tout seul.'
          : taken.previous
            ? <>Vous avez pris l’Anneau à <strong>{name(taken.previous)}</strong>.</>
            : 'Vous êtes la première personne à trouver l’Anneau.'}
      </p>
      <p className="muted small an-note">
        Un anneau pour les gouverner tous. Un rond doré entoure vos initiales, jusqu’à ce que quelqu’un d’autre tombe dessus à son tour.
      </p>
    </Modal>
  );
}

/** Anneau d'or : un tore en dégradé, avec un reflet. */
function RingSvg() {
  return (
    <svg viewBox="0 0 64 64" className="an-svg">
      <defs>
        <linearGradient id="an-or" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3b0" />
          <stop offset="0.35" stopColor="#f5c542" />
          <stop offset="0.7" stopColor="#b8860b" />
          <stop offset="1" stopColor="#ffe08a" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="34" rx="22" ry="18" fill="none" stroke="url(#an-or)" strokeWidth="9" />
      <ellipse cx="32" cy="34" rx="22" ry="18" fill="none" stroke="#7a5a00" strokeOpacity="0.35" strokeWidth="1" />
      <path d="M17 26 C 22 19, 30 17, 38 18" fill="none" stroke="#fffbe6" strokeWidth="2.5" strokeLinecap="round" opacity="0.85" />
    </svg>
  );
}
