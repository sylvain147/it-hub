import { useAppliedTheme } from '../theme';

/** Flammes du bas de l'écran : position, hauteur et rythme variés pour un vacillement naturel. */
const FLAMES = Array.from({ length: 16 }, (_, i) => ({ left: i * 6.6 + ((i * 37) % 5), height: 46 + ((i * 29) % 44), delay: ((i * 0.37) % 1.9).toFixed(2), duration: (1.5 + (i % 4) * 0.35).toFixed(2) }));

/**
 * Thème Nazgûl : fumées qui montent lentement et flammes des ténèbres au bas de l'écran. Purement décoratif (aucun
 * clic capté), coupé si l'utilisateur a demandé moins d'animations. La page étant inversée par le thème, les
 * couleurs de styles.css sont les inverses de celles vues à l'écran.
 */
export function NazgulEffects() {
  if (useAppliedTheme() !== 'nazgul') return null;
  return (
    <div className="ng-fx" aria-hidden="true">
      {[1, 2, 3, 4].map((i) => <span key={i} className={`ng-smoke ng-smoke-${i}`} />)}
      <div className="ng-flames">
        {FLAMES.map((f, i) => (
          <span key={i} className="ng-flame" style={{ left: `${f.left}%`, height: f.height, animationDelay: `${f.delay}s`, animationDuration: `${f.duration}s` }} />
        ))}
      </div>
    </div>
  );
}
