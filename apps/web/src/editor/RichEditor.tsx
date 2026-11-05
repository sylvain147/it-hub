import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import type { RichDoc } from '@samm/shared';
import { AssetImage } from './AssetImage';
import { uploadImage } from './assets';
import { toast } from '../components/ui';

interface Props {
  value: RichDoc;
  onChange: (doc: RichDoc) => void;
  editable: boolean;
  /** CDC propriétaire des images collées ; sans CDC, l'insertion d'images est désactivée. */
  cdcId?: string;
  /** Numéro de la section, pour numéroter les sous-sections (3.1, 3.2…). */
  sectionNumber?: number | null;
  placeholder?: string;
  /** Barre d'outils réduite (champs de fiche projet, notes). */
  compact?: boolean;
}

export function RichEditor({ value, onChange, editable, cdcId, sectionNumber = null, placeholder, compact }: Props) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true } }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      AssetImage,
      Placeholder.configure({ placeholder: placeholder ?? 'Rédigez ici…' }),
    ],
    content: value,
    editable,
    // `setEditable` émet aussi un événement « update » sans modification : on l'ignore pour ne pas marquer le document comme modifié.
    onUpdate: ({ editor, transaction }) => transaction.docChanged && onChangeRef.current(editor.getJSON() as RichDoc),
    editorProps: {
      handlePaste: (_view, event) => !!cdcId && insertImages(editorRef.current, cdcId, [...(event.clipboardData?.files ?? [])]),
      handleDrop: (_view, event) => !!cdcId && insertImages(editorRef.current, cdcId, [...((event as DragEvent).dataTransfer?.files ?? [])]),
    },
  });
  const editorRef = useRef<Editor | null>(null);
  editorRef.current = editor;

  useEffect(() => {
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  return (
    <div className={`rich${editable ? '' : ' rich-readonly'}${compact ? ' rich-compact' : ''}`} style={{ ['--sec' as string]: sectionNumber != null ? `"${sectionNumber}."` : '""' }}>
      {editable && editor && <Toolbar editor={editor} cdcId={cdcId} />}
      <EditorContent editor={editor} className={sectionNumber != null ? 'numbered' : ''} />
    </div>
  );
}

function insertImages(editor: Editor | null, cdcId: string, files: File[]): boolean {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!editor || !images.length) return false;
  void (async () => {
    for (const f of images) {
      try {
        const ref = await uploadImage(cdcId, f);
        editor.chain().focus().setImage({ src: ref }).run();
      } catch (e) {
        toast((e as Error).message, 'error');
      }
    }
  })();
  return true;
}

function Toolbar({ editor, cdcId }: { editor: Editor; cdcId?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      ul: e.isActive('bulletList'),
      ol: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();
  const B = ({ on, title, active, disabled, children }: { on: () => void; title: string; active?: boolean; disabled?: boolean; children: React.ReactNode }) => (
    <button type="button" className={`tb${active ? ' tb-on' : ''}`} title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={on}>
      {children}
    </button>
  );
  return (
    <div className="toolbar">
      <B on={() => c().toggleBold().run()} title="Gras (Ctrl+B)" active={s.bold}><b>G</b></B>
      <B on={() => c().toggleItalic().run()} title="Italique (Ctrl+I)" active={s.italic}><i>I</i></B>
      <B on={() => c().toggleStrike().run()} title="Barré" active={s.strike}><s>S</s></B>
      <span className="tb-sep" />
      <B on={() => c().toggleHeading({ level: 2 }).run()} title="Sous-section (x.1)" active={s.h2}>Titre</B>
      <B on={() => c().toggleHeading({ level: 3 }).run()} title="Sous-titre" active={s.h3}>Sous-titre</B>
      <span className="tb-sep" />
      <B on={() => c().toggleBulletList().run()} title="Liste à puces" active={s.ul}>• Liste</B>
      <B on={() => c().toggleOrderedList().run()} title="Liste numérotée" active={s.ol}>1. Liste</B>
      <B on={() => c().toggleBlockquote().run()} title="Citation" active={s.quote}>❝</B>
      <B
        on={() => {
          if (s.link) return c().unsetLink().run();
          const href = prompt('Adresse du lien :', 'https://');
          if (href) c().setLink({ href }).run();
        }}
        title="Lien"
        active={s.link}
      >
        🔗
      </B>
      <span className="tb-sep" />
      <B on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insérer un tableau">▦ Tableau</B>
      {s.table && (
        <>
          <B on={() => c().addRowAfter().run()} title="Ajouter une ligne">+ ligne</B>
          <B on={() => c().addColumnAfter().run()} title="Ajouter une colonne">+ col.</B>
          <B on={() => c().deleteRow().run()} title="Supprimer la ligne">− ligne</B>
          <B on={() => c().deleteColumn().run()} title="Supprimer la colonne">− col.</B>
          <B on={() => c().deleteTable().run()} title="Supprimer le tableau">✕ tableau</B>
        </>
      )}
      {cdcId && (
        <>
          <B on={() => fileRef.current?.click()} title="Insérer une image (ou collez-la directement)">🖼 Image</B>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg"
            hidden
            onChange={(e) => {
              insertImages(editor, cdcId, [...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </>
      )}
      <span className="tb-flex" />
      <B on={() => c().undo().run()} title="Annuler (Ctrl+Z)" disabled={!s.canUndo}>↶</B>
      <B on={() => c().redo().run()} title="Rétablir (Ctrl+Maj+Z)" disabled={!s.canRedo}>↷</B>
    </div>
  );
}
