import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { codeLanguage, jsonTokens } from '@samm/shared';

/** Coloration du JSON dans les blocs de code de l'éditeur (classes `tok-*`, communes avec `MarkdownView`). */
export const CodeHighlight = Extension.create({
  name: 'codeHighlight',
  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>('codeHighlight');
    return [
      new Plugin({
        key,
        state: {
          init: (_, { doc }) => decorate(doc),
          apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old),
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const text = node.textContent;
    if (codeLanguage(node.attrs.language, text) === 'json') {
      let at = pos + 1;
      for (const t of jsonTokens(text)) {
        if (t.kind !== 'space' && t.kind !== 'other') decos.push(Decoration.inline(at, at + t.text.length, { class: `tok-${t.kind}` }));
        at += t.text.length;
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decos);
}
