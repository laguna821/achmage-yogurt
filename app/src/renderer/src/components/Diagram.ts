import { mount, type Mounted } from 'pele'
import DOMPurify from 'dompurify'

/** All render paths use the same local engine and theme; source bytes stay in Markdown. */
export function mountDiagram(container: HTMLElement, source: string, changed: () => void = () => {}) {
  let mounted: Mounted | undefined, destroyed = false
  queueMicrotask(() => {
    if (destroyed || !container.isConnected) return
    mounted = mount(container, source, {
      links: false, images: false, limit: 20_000, outputLimit: 2_000_000, maxEdges: 500,
      zoom: false,
      sanitize: svg => DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM_FRAGMENT: true,
        FORBID_TAGS: ['image', 'a', 'foreignObject', 'script'],
      }),
      onRender: () => { container.dataset.rendered = 'true'; changed() },
      onError: () => { container.dataset.rendered = 'false'; changed() },
    })
  })
  return () => { destroyed = true; mounted?.destroy() }
}

export function diagramButton(label: string, text: string, run: () => void) {
  const button = document.createElement('button')
  button.type = 'button'; button.title = label; button.setAttribute('aria-label', label); button.textContent = text
  button.addEventListener('mousedown', e => e.stopPropagation())
  button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); run() })
  return button
}

export function diagramCopyButton(source: string) {
  const button = diagramButton('Mermaid 코드 블록 복사', '복사', () => {
    void navigator.clipboard.writeText(source).then(() => { button.textContent = '복사됨' }, () => { button.textContent = '복사 실패 · 소스에서 선택하세요' })
  })
  return button
}
