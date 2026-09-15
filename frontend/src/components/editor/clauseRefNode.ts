import { mergeAttributes, Node } from '@tiptap/core';

/**
 * 条款引用块：把条款全文内嵌为 <section class="clause-ref"
 * data-clause-ref="..." data-clause-hash="...">…</section>。
 * 自定义节点是为了让 ProseMirror 保留外壳与引用属性，
 * 否则 StarterKit 会在 getHTML() 时丢弃未知 section 及其 data-* 属性。
 */
export const ClauseRef = Node.create({
  name: 'clauseRef',
  group: 'block',
  content: 'block+',

  addAttributes() {
    return {
      clauseId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-clause-ref'),
        renderHTML: (attributes: { clauseId?: string | null }) => ({
          'data-clause-ref': attributes.clauseId
        })
      },
      clauseHash: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-clause-hash'),
        renderHTML: (attributes: { clauseHash?: string | null }) => ({
          'data-clause-hash': attributes.clauseHash
        })
      }
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-clause-ref]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes({ class: 'clause-ref' }, HTMLAttributes), 0];
  }
});
