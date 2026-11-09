import '@fontsource/almendra/latin-700.css';

/** Logo et nom du hub : « Hobbit » en lettres calligraphiées, avec un brin de feuilles (la Comté n'est jamais loin). */
export function Brand() {
  return (
    <>
      <img className="brand-logo" src="/hobbit.png" alt="" />
      <span className="wordmark">
        Hobbit
        <Leaves />
      </span>
    </>
  );
}

/** Brin de trois feuilles, posé en haut à droite du nom. */
function Leaves() {
  return (
    <svg className="wordmark-leaves" viewBox="0 0 28 22" aria-hidden="true">
      <path className="leaf-stem" d="M2 20 C 9 17, 15 12, 22 3" />
      <path className="leaf leaf-1" d="M9 16.5 C 6 12, 8 8.5, 11 7.5 C 12.5 11, 12 14.5, 9 16.5 Z" />
      <path className="leaf leaf-2" d="M15 11.5 C 18.5 13.5, 22.5 13, 24 10 C 21 7.8, 17.5 8.5, 15 11.5 Z" />
      <path className="leaf leaf-3" d="M22 3 C 20 1, 17 1.5, 16 4.2 C 18.5 5.5, 21 5, 22 3 Z" />
    </svg>
  );
}
