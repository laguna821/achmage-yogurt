import { Node, mergeAttributes } from '@tiptap/core'

/** Native editable tables keep cells in the same Markdown save/export path. */
export const RecordTable = Node.create({
  name: 'table', group: 'block', content: 'tableRow+', isolating: true,
  parseHTML: () => [{ tag: 'table' }],
  renderHTML: ({ HTMLAttributes }) => ['table', mergeAttributes(HTMLAttributes), ['tbody', 0]],
})
export const RecordRow = Node.create({
  name: 'tableRow', content: '(tableCell | tableHeader)+',
  parseHTML: () => [{ tag: 'tr' }], renderHTML: () => ['tr', 0],
})
export const RecordCell = Node.create({
  name: 'tableCell', content: 'block+', isolating: true,
  parseHTML: () => [{ tag: 'td' }], renderHTML: () => ['td', 0],
})
export const RecordHeader = Node.create({
  name: 'tableHeader', content: 'block+', isolating: true,
  parseHTML: () => [{ tag: 'th' }], renderHTML: () => ['th', 0],
})

let serial = 0
const allowed = /^(flowchart\s+(LR|TB)|sequenceDiagram|mindmap|timeline|gantt|stateDiagram-v2)\b/

/** Strict, local Mermaid. The original text remains editable and is never replaced by SVG. */
export const RecordDiagram = Node.create({
  name: 'mermaid', group: 'block', atom: true,
  addAttributes: () => ({ source: { default: '' }, complete: { default: true, rendered: false } }),
  parseHTML: () => [{ tag: 'figure[data-mermaid-source]', getAttrs: element => ({ source: element.getAttribute('data-mermaid-source') || '' }) }],
  renderHTML: ({ node }) => ['figure', { 'data-mermaid-source': node.attrs.source }, ['pre', String(node.attrs.source)]],
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('figure')
      dom.className = 'record-diagram'; dom.contentEditable = 'false'
      const caption = document.createElement('figcaption'), preview = document.createElement('div')
      preview.className = 'record-diagram-preview'
      const details = document.createElement('details'), summary = document.createElement('summary'), textarea = document.createElement('textarea')
      summary.textContent = '도식 원문'; textarea.setAttribute('aria-label', '도식 원문'); textarea.spellcheck = false
      details.append(summary, textarea); dom.append(caption, preview, details)
      let revision = 0, destroyed = false, current = node
      const render = async () => {
        const version = ++revision, source = String(current.attrs.source)
        textarea.value = source; textarea.readOnly = !editor.isEditable
        dom.setAttribute('data-mermaid-source', source)
        caption.textContent = /^\s*%%\s*@caption:\s*(.+)$/m.exec(source)?.[1] || '도식'
        preview.textContent = current.attrs.complete ? '도식을 그리는 중…' : '도식을 작성하는 중…'
        if (!current.attrs.complete) return
        try {
          if (source.length > 20_000 || !allowed.test(source.trim()) || /%%\{|^\s*(?:click|style|classDef|linkStyle)\b|<\/?[a-z]|https?:\/\//im.test(source)) throw new Error('지원하지 않는 도식 형식')
          const { default: mermaid } = await import('mermaid')
          mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true, theme: 'neutral',
            flowchart: { htmlLabels: false }, fontFamily: 'sans-serif' })
          const { svg } = await mermaid.render(`record-diagram-${++serial}`, source)
          if (destroyed || version !== revision) return
          preview.innerHTML = svg
          const picture = preview.querySelector('svg')
          if (picture) { picture.style.width = `${Math.min(760, picture.viewBox.baseVal.width || 760)}px`; picture.style.maxHeight = '420px' }
          preview.setAttribute('role', 'img')
          preview.setAttribute('aria-label', /^\s*%%\s*@alt:\s*(.+)$/m.exec(source)?.[1] || caption.textContent || '도식')
          dom.dataset.rendered = 'true'
        } catch {
          if (destroyed || version !== revision) return
          preview.textContent = '도식을 표시하지 못했습니다. 원문을 확인하세요.'
          dom.dataset.rendered = 'false'
        }
      }
      textarea.addEventListener('change', () => {
        const pos = getPos()
        if (editor.isEditable && typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { source: textarea.value, complete: true }))
      })
      details.addEventListener('toggle', () => { textarea.readOnly = !editor.isEditable })
      void render()
      return { dom,
        update(next) { if (next.type !== current.type) return false; if (next.attrs.source !== current.attrs.source || next.attrs.complete !== current.attrs.complete) { current = next; void render() } return true },
        stopEvent: event => details.contains(event.target as globalThis.Node), ignoreMutation: () => true,
        destroy: () => { destroyed = true; revision++ },
      }
    }
  },
})
