import Image from '@tiptap/extension-image';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { useAssetUrl } from './assets';

function ImageView({ node, selected, updateAttributes, editor }: ReactNodeViewProps) {
  const src = String(node.attrs.src ?? '');
  const alt = (node.attrs.alt as string | null) ?? '';
  const url = useAssetUrl(src);
  return (
    <NodeViewWrapper className={`img-node${selected ? ' is-selected' : ''}`} data-drag-handle>
      {url ? <img src={url} alt={alt} draggable={false} /> : <div className="img-missing">{url === '' ? 'Image introuvable' : 'Chargement de l’image…'}</div>}
      {(alt || editor.isEditable) && (
        <input
          className="img-caption"
          value={alt}
          placeholder={editor.isEditable ? 'Légende (facultative)' : ''}
          readOnly={!editor.isEditable}
          onChange={(e) => updateAttributes({ alt: e.target.value || null })}
        />
      )}
    </NodeViewWrapper>
  );
}

/** Image stockée dans le bucket privé, affichée via une URL temporaire. */
export const AssetImage = Image.extend({
  // Le rendu HTML brut (presse-papiers…) ne doit pas tenter de charger une URL « asset: ».
  renderHTML({ HTMLAttributes }) {
    const { src, ...rest } = HTMLAttributes as Record<string, unknown>;
    return ['img', { ...rest, 'data-asset': src }];
  },
  parseHTML() {
    return [
      { tag: 'img[data-asset]', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('data-asset'), alt: (el as HTMLElement).getAttribute('alt') }) },
      { tag: 'img[src]:not([src^="data:"])' },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
}).configure({ inline: false, allowBase64: false });
