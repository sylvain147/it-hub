import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { BOUTON_ROUGE_CHANCE, BOUTON_ROUGE_PAUSE_MIN, type BoutonRougeScores } from '@samm/shared';
import { api } from '../api';
import { useAuth } from '../auth';
import { Modal, toast } from '../components/ui';
import { useUsers } from '../users/context';

/**
 * Petit jeu caché : de temps en temps, au hasard d'un changement de page, un bouton rouge « NE PAS CLIQUER »
 * apparaît quelques secondes. Ceux qui cliquent quand même ont droit à une scène de déception et entrent
 * au tableau de la honte. `?bouton-rouge` dans l'adresse le fait apparaître à coup sûr (démonstration).
 */

const LAST_KEY = 'hub.boutonRouge.derniere';
/** Durée d'affichage du bouton avant qu'il ne reparte. */
const VISIBLE_MS = 20_000;
/** Emplacements possibles, à l'écart du contenu principal. */
const SPOTS = ['br-spot-bas-droite', 'br-spot-bas-gauche', 'br-spot-haut-droite', 'br-spot-milieu-droite'];

/** Une chance sur BOUTON_ROUGE_CHANCE, et pas plus d'une fois par pause. */
function luckyDraw(): boolean {
  const last = Number(localStorage.getItem(LAST_KEY) ?? 0);
  if (Date.now() - last < BOUTON_ROUGE_PAUSE_MIN * 60_000) return false;
  if (Math.random() * BOUTON_ROUGE_CHANCE >= 1) return false;
  localStorage.setItem(LAST_KEY, String(Date.now()));
  return true;
}

/** Message de déception, selon le nombre de récidives. */
function verdict(count: number): string {
  if (count <= 1) return 'Il y avait pourtant écrit « NE PAS CLIQUER »…';
  if (count === 2) return 'Encore ? On pensait que la première fois était un accident.';
  if (count < 5) return `${count} fois. La curiosité est un vilain défaut.`;
  if (count < 10) return `${count} fois. Récidiviste.`;
  if (count < 20) return `${count} fois. On va devoir en parler en comité de pilotage.`;
  return `${count} fois. Un ticket a été ouvert à votre nom chez le prestataire. (Non.)`;
}

/** Trombone triste : quatre notes qui descendent, à faible volume (Web Audio, rien à télécharger). */
function sadTrombone() {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.gain.value = 0.06;
    gain.connect(ctx.destination);
    [392, 370, 349, 330].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const t = ctx.currentTime + i * 0.45;
      o.frequency.setValueAtTime(freq, t);
      if (i === 3) o.frequency.linearRampToValueAtTime(freq - 25, t + 1.1);
      o.connect(gain);
      o.start(t);
      o.stop(t + (i === 3 ? 1.2 : 0.4));
    });
    setTimeout(() => void ctx.close(), 3500);
  } catch {
    /* pas de son : tant pis */
  }
}

export function BoutonRouge() {
  const location = useLocation();
  const [spot, setSpot] = useState<string | null>(null);
  const [scores, setScores] = useState<BoutonRougeScores | null>(null);

  // Un tirage au sort à chaque changement de page.
  useEffect(() => {
    const forced = new URLSearchParams(location.search).has('bouton-rouge');
    if (!forced && (spot || !luckyDraw())) return;
    setSpot(SPOTS[Math.floor(Math.random() * SPOTS.length)]!);
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!spot) return;
    const t = setTimeout(() => setSpot(null), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [spot]);

  async function click() {
    setSpot(null);
    sadTrombone();
    try {
      setScores(await api.clicBoutonRouge());
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      {spot && (
        <button className={`br-button ${spot}`} onClick={() => void click()}>
          NE PAS CLIQUER
        </button>
      )}
      {scores && <Deception scores={scores} onClose={() => setScores(null)} />}
    </>
  );
}

function Deception({ scores, onClose }: { scores: BoutonRougeScores; onClose: () => void }) {
  const { me } = useAuth();
  const { name } = useUsers();
  return (
    <Modal title="Vous avez cliqué." onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Je ne recommencerai plus (promis)</button>}>
      <div className="br-scene" aria-hidden="true">
        <div className="br-face">
          <span>😞</span>
          <i className="br-tear br-tear-1" />
          <i className="br-tear br-tear-2" />
        </div>
        <div className="br-sigh">soupir…</div>
      </div>
      <p className="br-verdict">{verdict(scores.mine)}</p>
      <p className="muted small br-count">
        Compteur de clics : <strong>{scores.mine}</strong>
      </p>
      {scores.ranking.length > 0 && (
        <>
          <h3 className="br-title">🏆 Tableau de la honte</h3>
          <ol className="br-ranking">
            {scores.ranking.map((s) => (
              <li key={s.email} className={s.email === me.email ? 'me' : ''}>
                <span>{name(s.email)}</span>
                <strong>{s.count}</strong>
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}
