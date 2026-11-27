import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractRawText } from 'mammoth'
import { simpleParser } from 'mailparser'
import { mediaTool } from '../imports/tools'
import pinned from '../../../resources/achmage-transcript/manifest.json'
import type { Evidence } from '../../shared/organizer'

const exec = (file: string, args: string[], signal?: AbortSignal) => new Promise<{ text: string; code: number }>((resolve, reject) => {
  execFile(file, args, { signal, timeout: 45_000, maxBuffer: 2_000_000, windowsHide: true }, (e, stdout, stderr) => {
    if (signal?.aborted) return reject(new Error('Stopped'))
    if (e && typeof e.code !== 'number') return reject(new Error('자료 도구를 실행하지 못했습니다.'))
    resolve({ text: String(stdout) + String(stderr), code: e ? Number(e.code) : 0 })
  })
})
export const sha = (text: string) => createHash('sha256').update(text).digest('hex')
export async function importMaterial(path: string, id: string, signal?: AbortSignal): Promise<Evidence> {
  const ext = extname(path).toLowerCase()
  if (statSync(path).size > 20_000_000) throw new Error('자료 한 개는 20MB까지 첨부할 수 있습니다.')
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return { id, provider: 'attached', title: basename(path), locator: path, text: '첨부 이미지 · 정리 시작 후 선택한 모델로 읽습니다.', revision: createHash('sha256').update(readFileSync(path)).digest('hex'), issueIds: [], imagePath: path }
  let text: string
  if (ext === '.pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const worker = join(process.resourcesPath || '', 'pdf/pdf.worker.mjs')
    if (existsSync(worker)) pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href
    const task = pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, disableFontFace: true }); const doc = await task.promise
    try { const pages: string[] = []; for (let n = 1; n <= doc.numPages; n++) { if (signal?.aborted) throw new Error('Stopped'); const content = await (await doc.getPage(n)).getTextContent(); pages.push(content.items.map(i => 'str' in i ? i.str : '').join(' ')); if (pages.join('').length > 500000) throw new Error('PDF 추출 텍스트가 너무 큽니다.') }; text = pages.join('\n\n') } finally { await task.destroy() }
  }
  else if (ext === '.docx') text = (await extractRawText({ path })).value
  else if (ext === '.eml') { const email = await simpleParser(readFileSync(path)); text = `제목: ${email.subject || ''}\n발신: ${email.from?.text || ''}\n일시: ${email.date?.toISOString() || ''}\n${email.text || ''}` }
  else { const bytes = readFileSync(path); text = bytes.toString('utf8'); if (text.includes('�')) text = new TextDecoder('euc-kr').decode(bytes); text = text.replace(/^\uFEFF/, '') }
  if (Buffer.byteLength(text) > 500_000) throw new Error('자료 한 개의 추출 텍스트는 500KB까지 사용할 수 있습니다.')
  if (!text.trim()) throw new Error('자료에서 텍스트를 읽지 못했습니다. 스캔 PDF는 텍스트 자료로 첨부하세요.')
  return { id, provider: 'attached', title: basename(path), locator: path, text, revision: sha(text), issueIds: [] }
}

/** Pinned owner-authored skill scripts are shipped as ordinary resources, outside app.asar. */
export class TranscriptRuntime {
  constructor(private skillDir: string) {}
  private run(args: string[], signal?: AbortSignal) { return exec(this.python(), [join(this.skillDir, 'scripts/transcript.py'), ...args], signal) }
  private python() { const p = join(process.resourcesPath || '', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'); return existsSync(p) ? p : process.platform === 'win32' ? 'python' : 'python3' }
  available() { try { return createHash('sha256').update(readFileSync(join(this.skillDir, 'scripts/transcript.py'))).digest('hex') === pinned.files['scripts/transcript.py'] } catch { return false } }
  async prepare(work: string, transcript: string, glossary: string[], signal?: AbortSignal) {
    mkdirSync(work, { recursive: true })
    const raw = transcript.replace(/^\[([^\]]+)\]\s*\[channel=[^;]+; label=([^\]]+)\]\s*/gm, '[$1] $2: ')
    writeFileSync(join(work, 'original.txt'), raw)
    writeFileSync(join(work, 'glossary.txt'), glossary.join('\n') + '\n')
    const result = await this.run(['prepare', join(work, 'original.txt'), '--work', work], signal)
    if (result.code) throw new Error('전사 준비 검사를 통과하지 못했습니다.')
    return ['speakers.md', 'terms.md'].map(p => readFileSync(join(work, p), 'utf8')).join('\n').slice(0, 6000)
  }
  async apply(work: string, speakerMap: object, corrections: object[], signal?: AbortSignal) {
    writeFileSync(join(work, 'speaker-map.json'), JSON.stringify(speakerMap, null, 2))
    writeFileSync(join(work, 'corrections.json'), JSON.stringify(corrections, null, 2))
    const result = await this.run(['apply', join(work, 'turns.txt'), '--speakers', join(work, 'speaker-map.json'), '--corrections', join(work, 'corrections.json'), '--out', join(work, 'turns.named.txt')], signal)
    if (result.code) throw new Error('전사 보정 적용 검사를 통과하지 못했습니다.')
    writeFileSync(join(work, 'apply.log'), result.text)
    return readFileSync(join(work, 'turns.named.txt'), 'utf8')
  }
  async check(work: string, md: string, profile: 'record' | 'minutes', sources: Evidence[], signal?: AbortSignal) {
    const file = join(work, 'record.md'); writeFileSync(file, md)
    const paths = [join(work, 'turns.txt')]
    for (const e of sources) { const p = join(work, `source-${e.id.replace(/[^A-Za-z0-9_-]/g, '')}.txt`); writeFileSync(p, e.text); paths.push(p) }
    const lint = await this.run(['lint', file, '--profile', profile, ...(profile === 'record' ? ['--reader-format'] : [])], signal)
    const facts = await this.run(['facts', file, '--sources', ...paths], signal)
    writeFileSync(join(work, 'lint.log'), lint.text); writeFileSync(join(work, 'facts.log'), facts.text)
    return { ok: lint.code === 0, lint: lint.text, facts: facts.text }
  }
}
