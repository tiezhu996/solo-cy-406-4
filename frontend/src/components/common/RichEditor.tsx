import { forwardRef, useEffect, useImperativeHandle } from 'react';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ClauseRef } from '../editor/clauseRefNode';
import { EditorToolbar } from '../editor/EditorToolbar';

export interface RichEditorHandle {
  /** 以 TipTap 事务在文末插入一段 HTML（条款引用块 / 占位符），保证自定义节点被正确解析保留 */
  insertHtml: (html: string) => void;
}

interface RichEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const RichEditor = forwardRef<RichEditorHandle, RichEditorProps>(function RichEditor(
  { value, onChange, placeholder = '输入合同正文...', minHeight = 360, onUndo, onRedo, canUndo, canRedo },
  ref
) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      ClauseRef,
      Placeholder.configure({
        placeholder
      })
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'rich-editor__content',
        style: `min-height: ${minHeight}px`
      }
    },
    onUpdate({ editor: activeEditor }) {
      onChange(activeEditor.getHTML());
    }
  });

  useEffect(() => {
    if (!editor) {
      return;
    }

    const current = editor.getHTML();
    if (value !== current) {
      editor.commands.setContent(value, false);
    }
  }, [editor, value]);

  useImperativeHandle(
    ref,
    () => ({
      insertHtml(html: string) {
        if (!editor || !html) {
          return;
        }

        // 用事务插入，TipTap 会把 <section data-clause-ref> 解析为 clauseRef 节点；
        // 不要用外层拼接整串再 setContent —— 聚焦态下那条受控路径可能丢失节点
        const size = editor.state.doc.content.size;
        editor.chain().focus().insertContentAt(size, html).run();
        onChange(editor.getHTML());
      }
    }),
    [editor, onChange]
  );

  return (
    <div className="rich-editor">
      <EditorToolbar editor={editor} onUndo={onUndo} onRedo={onRedo} canUndo={canUndo} canRedo={canRedo} />
      <EditorContent editor={editor} />
    </div>
  );
});
