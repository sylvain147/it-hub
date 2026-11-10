/**
 * Patch note : construit à chaque build du front (donc à chaque déploiement, et au démarrage en local) à partir de
 * l'historique git de la branche courante. Une entrée par pull request fusionnée (titre, date, numéro) avec le détail
 * de ses commits ; un commit poussé directement fait une entrée à lui seul. Exposé au front par le module virtuel
 * `virtual:patch-notes` (voir `src/patchnotes/`).
 *
 * Sans historique git (archive, clone superficiel), la liste est vide ou partielle : le déploiement doit cloner
 * l'historique complet.
 */
import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';
import type { PatchNote, PatchNoteChange } from './src/patchnotes/types';

const MAX_ENTRIES = 300;
const FIELD = '\x1f';
const RECORD = '\x1e';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Message de commit sans les lignes techniques (co-auteurs, signature de l'outil). */
function cleanBody(body: string): string {
  return body
    .split('\n')
    .filter((l) => !/^(co-authored-by|signed-off-by):/i.test(l.trim()) && !l.includes('Generated with [Claude Code]'))
    .join('\n')
    .trim();
}

function parse(out: string): { hash: string; parents: string[]; date: string; subject: string; body: string }[] {
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [hash = '', parents = '', date = '', subject = '', body = ''] = r.split(FIELD);
      return { hash, parents: parents.split(' ').filter(Boolean), date, subject: subject.trim(), body: cleanBody(body) };
    });
}

const FORMAT = `--format=%H${FIELD}%P${FIELD}%cI${FIELD}%s${FIELD}%b${RECORD}`;

export function readPatchNotes(): PatchNote[] {
  let commits;
  try {
    commits = parse(git(['log', '--first-parent', `-n${MAX_ENTRIES}`, FORMAT, 'HEAD']));
  } catch {
    return [];
  }
  return commits.map((c) => {
    const pr = /^Merge pull request #(\d+)/.exec(c.subject);
    if (c.parents.length < 2) {
      return { id: c.hash, date: c.date, title: c.subject === 'Initial commit' ? 'Mise en service de Hobbit' : c.subject, pr: null, changes: c.body ? [{ title: c.subject, details: c.body }] : [] };
    }
    let changes: PatchNoteChange[] = [];
    try {
      changes = parse(git(['log', '--no-merges', '--reverse', FORMAT, `${c.parents[0]}..${c.parents[1]}`])).map((x) => ({ title: x.subject, details: x.body }));
    } catch {
      // Historique incomplet : l'entrée garde son seul titre.
    }
    // Titre de la pull request (première ligne du message de fusion) ; GitHub l'abrège (« … ») : on reprend alors le commit complet.
    const first = c.body.split('\n')[0]?.trim() ?? '';
    const prefix = first.replace(/…$/, '');
    const title = (first.endsWith('…') && changes.find((x) => x.title.startsWith(prefix))?.title) || first || changes[0]?.title || c.subject;
    return { id: c.hash, date: c.date, title, pr: pr ? Number(pr[1]) : null, changes };
  });
}

const VIRTUAL_ID = 'virtual:patch-notes';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** Fichier du build lu par le déploiement pour annoncer la nouvelle version sur Teams (`infra/lib/hub-stack.ts`). */
export const PATCH_NOTES_FILE = 'patch-notes.json';

export function patchNotesPlugin(): Plugin {
  let notes: PatchNote[] | null = null;
  const read = () => (notes ??= readPatchNotes());
  return {
    name: 'hobbit-patch-notes',
    buildStart: () => {
      notes = null;
    },
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
    load: (id) => (id === RESOLVED_ID ? `export default ${JSON.stringify(read())};` : undefined),
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: PATCH_NOTES_FILE, source: JSON.stringify(read()) });
    },
  };
}
