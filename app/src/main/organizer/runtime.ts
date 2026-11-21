import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
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
  if (ext === '.pdf') { const result = await exec('pdftotext', ['-layout', path, '-'], signal); if (result.code) throw new Error('PDF 텍스트를 읽지 못했습니다. 암호나 파일 형식을 확인하세요.'); text = result.text }
  else if (ext === '.docx') { const result = await exec('python3', ['-c', 'import sys,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); i=z.getinfo("word/document.xml"); assert i.file_size<20000000; r=E.fromstring(z.read(i)); print("\\n".join("".join(p.itertext()) for p in r.iter() if p.tag.endswith("}p")))', path], signal); if (result.code) throw new Error('Word 자료를 읽지 못했습니다.'); text = result.text }
  else if (ext === '.eml') {
    const result = await exec('python3', ['-c', `import sys, email.policy, email.parser, re, html
m=email.parser.BytesParser(policy=email.policy.default).parsebytes(open(sys.argv[1],'rb').read())
print('\\n'.join(k+': '+str(m.get(k,'')) for k in ['Subject','From','To','Date']))
p=m.get_body(preferencelist=('plain','html'))
if p:
 s=p.get_content()
 print(html.unescape(re.sub('<[^>]+>',' ',s)) if p.get_content_subtype()=='html' else s)
`, path], signal)
    if (result.code) throw new Error('이메일 자료를 읽지 못했습니다.'); text = result.text
  }
  else { const bytes = readFileSync(path); text = bytes.toString('utf8'); if (text.includes('�')) text = new TextDecoder('euc-kr').decode(bytes); text = text.replace(/^\uFEFF/, '') }
  if (Buffer.byteLength(text) > 500_000) throw new Error('자료 한 개의 추출 텍스트는 500KB까지 사용할 수 있습니다.')
  if (!text.trim()) throw new Error('자료에서 텍스트를 읽지 못했습니다. 스캔 PDF는 텍스트 자료로 첨부하세요.')
  return { id, provider: 'attached', title: basename(path), locator: path, text, revision: sha(text), issueIds: [] }
}

/** Pinned owner-authored skill scripts are shipped as ordinary resources, outside app.asar. */
export class TranscriptRuntime {
  constructor(private skillDir: string) {}
  private run(args: string[], signal?: AbortSignal) { return exec('python3', [join(this.skillDir, 'scripts/transcript.py'), ...args], signal) }
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
    const lint = await this.run(['lint', file, '--profile', profile], signal)
    const facts = await this.run(['facts', file, '--sources', ...paths], signal)
    writeFileSync(join(work, 'lint.log'), lint.text); writeFileSync(join(work, 'facts.log'), facts.text)
    return { ok: lint.code === 0, lint: lint.text, facts: facts.text }
  }
}
