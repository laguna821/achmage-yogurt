import { clipboard, ClipboardItem, dialog, ipcMain, protocol } from 'electron'
import { createWriteStream, readFileSync } from 'node:fs'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ZipFile } from 'yazl'
import type { Store } from '../store'
import type { NotesModel } from '../notes/model'
import type { Queue } from '../notes/queue'
import type { VideoOptions, VideoState } from '../../shared/video'
import { VIDEO_ASSET } from '../../shared/video'
import { VideoWorkspace } from './index'
import { fileNameFor } from '../../shared/exportNotes'
import { isFake } from '../paths'
export const VIDEO_SCHEME = 'yogurt-video'
export function videoAssets(md: string): string[] { return [...new Set([...md.matchAll(/!\[[^\]]*\]\(assets\/([^\s)]+)\)/g)].map(m => m[1]))].filter(f => VIDEO_ASSET.test(f)) }
export async function writeVideoZip(path: string, name: string, md: string, assets: { file: string; path: string }[]) {
  const zip = new ZipFile(), output = createWriteStream(path)
  const done = new Promise<void>((resolve, reject) => { output.on('close', resolve); output.on('error', reject); zip.outputStream.on('error', reject); zip.on('error', reject) })
  zip.outputStream.pipe(output); zip.addBuffer(Buffer.from(md, 'utf8'), name)
  for (const asset of assets) zip.addBuffer(readFileSync(asset.path), 'assets/' + asset.file)
  zip.end(); await done
}
export function createVideoHost(p: { root: string; store: Store; queue: Queue; model: NotesModel; modelKey: () => string; context?: ConstructorParameters<typeof VideoWorkspace>[0]['context']; propose: (id: string, md: string) => void; changed: (s: VideoState) => void; notesChanged: (id: string) => void; busy?: (id: string) => boolean }) {
  const workspace = new VideoWorkspace(p), pending = new Map<string, AbortController>()
  const check = (id: unknown): string => { if (typeof id !== 'string') throw new Error('기록을 확인하세요.'); workspace.dir(id); return id }
  const commit = (id: string, md: string, expected?: string | null) => {
    if (!p.store.meeting(id) || p.store.meeting(id)?.trashedAt != null) throw new Error('기록이 삭제됐습니다.')
    const now = p.store.notes(id).enhanced
    if (now !== null || expected !== undefined && now !== expected) p.propose(id, md)
    else p.store.setNotes(id, { enhanced: md, edited: false })
    p.notesChanged(id)
  }
  const launch = (id: string, run: (llm: Awaited<ReturnType<NotesModel['llm']>>, signal: AbortSignal) => Promise<void>, failed?:(message:string,cancelled:boolean)=>void) => {
    if (pending.has(id) || p.busy?.(id)) throw new Error('이 기록의 정리가 이미 진행 중입니다.')
    const controller = new AbortController(); pending.set(id, controller)
    void p.queue.enqueue(async signal => { const stop = AbortSignal.any([signal, controller.signal]); if (controller.signal.aborted) return; await run(await p.model.llm(stop), stop) }, 'enhance', id)
      .catch(error => {const message=error instanceof Error?error.message:String(error);if(failed)failed(message,controller.signal.aborted);else workspace.stage(id, controller.signal.aborted ? 'cancelled' : 'failed', message) })
      .finally(() => pending.delete(id))
  }
  const start = (id: string, options?: Partial<VideoOptions>) => {
    check(id); if (pending.has(id) || p.busy?.(id)) throw new Error('이 기록의 정리가 이미 진행 중입니다.')
    const state = options ? workspace.configure(id, options) : workspace.get(id); if (!state) throw new Error('YouTube 원본이 없습니다.')
    if (state.options.depth === 'transcript') return state
    const expected = p.store.notes(id).enhanced
    workspace.stage(id, 'queued', '녹음·전사와 모델 대기열을 확인하고 있습니다.')
    launch(id, async (llm, signal) => { const md = await workspace.run(id, llm, signal); if (!signal.aborted) commit(id, md, expected) })
    return workspace.get(id)!
  }
  ipcMain.handle('video:get', (_e, id: unknown) => workspace.get(check(id)))
  ipcMain.handle('video:start', (_e, id: unknown, options: Partial<VideoOptions>) => start(check(id), options))
  ipcMain.handle('video:cancel', (_e, id: unknown) => { const key = check(id); pending.get(key)?.abort(); const s=workspace.get(key);if(s?.research.some(r=>['queued','searching','writing'].includes(r.phase))){for(const r of s.research)if(['queued','searching','writing'].includes(r.phase)){r.phase='cancelled';r.message='조사를 중단했습니다. 읽은 자료는 보존했습니다.'}workspace.save(s);return s}return workspace.stage(key, 'cancelled', '작업을 중단했습니다. 확보한 자료와 완료 단계는 보존했습니다.') })
  ipcMain.handle('video:answer', (_e, id: unknown, answers: unknown) => { const key = check(id); if (pending.has(key) || !answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('확인 답변을 확인하세요.'); return workspace.answer(key, answers as Record<string, string>) })
  ipcMain.handle('video:frame', (_e, id: unknown, frameId: unknown, patch: unknown) => { const key = check(id); if (pending.has(key) || typeof frameId !== 'string' || !patch || typeof patch !== 'object') throw new Error('프레임 편집 정보를 확인하세요.'); return workspace.editFrame(key, frameId, patch) })
  ipcMain.handle('video:apply-changes', (_e, id: unknown) => { const key = check(id); if (pending.has(key)) throw new Error('진행 중입니다.'); commit(key, workspace.render(key)); return true })
  ipcMain.handle('video:research', (_e, id: unknown, topic: unknown) => {
    const key = check(id); if (typeof topic !== 'string' || pending.has(key) || p.busy?.(key)) throw new Error('주제를 확인하거나 현재 작업을 기다려 주세요.')
    const researchId = workspace.newResearch(key, topic)
    launch(key, async (llm, signal) => { await workspace.research(key, researchId, llm, signal) },(message,cancelled)=>{const s=workspace.get(key),run=s?.research.find(r=>r.id===researchId);if(s&&run){run.phase=cancelled?'cancelled':'failed';run.message=message;workspace.save(s)}})
    return workspace.get(key)
  })
  ipcMain.handle('video:append-research', (_e, id: unknown, researchId: unknown) => {
    const key = check(id), s = workspace.get(key), run = s?.research.find(r => r.id === researchId)
    if (pending.has(key) || !s || !run?.markdown || run.appended) throw new Error('추가할 조사 결과를 확인하세요.')
    commit(key, (p.store.notes(key).enhanced || '') + '\n\n---\n\n' + run.markdown); run.appended = true; workspace.save(s); return true
  })
  ipcMain.handle('video:copy', async (_e, id: unknown) => { const md = p.store.notes(check(id)).enhanced || ''; if (!md) return false; await clipboard.write([new ClipboardItem({ 'text/plain': md })]); return true })
  ipcMain.handle('video:export', async (_e, id: unknown, withAssets: unknown) => {
    const key = check(id), meeting = p.store.meeting(key)!, md = p.store.notes(key).enhanced
    if (!md) throw new Error('내보낼 정리본이 없습니다.')
    const names = videoAssets(md), assets = names.map(file => { const path = workspace.asset(key, file); if (!path) throw new Error('등록된 이미지 파일을 찾지 못했습니다: ' + file); return { file, path } })
    const bundle = withAssets === true, filename = fileNameFor(meeting.title, meeting.startedAt)
    const target = isFake() && process.env.YOGURT_EXPORT_PATH ? { canceled: false, filePath: process.env.YOGURT_EXPORT_PATH } : await dialog.showSaveDialog({ title: bundle ? '이미지 포함 Markdown 내보내기' : 'Markdown 내보내기', defaultPath: filename.replace(/\.md$/, bundle ? '.zip' : '.md'), filters: [{ name: bundle ? 'Markdown + 이미지 ZIP' : 'Markdown', extensions: [bundle ? 'zip' : 'md'] }] })
    if (target.canceled || !target.filePath) return 'cancelled'
    const stage = await mkdtemp(join(dirname(target.filePath), '.achmage-video-'))
    try { const path = join(stage, bundle ? 'document.zip' : 'document.md'); if (bundle) await writeVideoZip(path, filename, md, assets); else await writeFile(path, md, 'utf8'); await rename(path, target.filePath); return 'saved' }
    finally { await rm(stage, { recursive: true, force: true }) }
  })
  protocol.handle(VIDEO_SCHEME, request => {
    try { const url = new URL(request.url); if (url.username || url.password || url.port || url.search || url.hash) return new Response('', { status: 404 }); const path = workspace.asset(url.hostname, decodeURIComponent(url.pathname.slice(1))); return path ? new Response(new Uint8Array(readFileSync(path)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'Access-Control-Allow-Origin': '*' } }) : new Response('', { status: 404 }) }
    catch { return new Response('', { status: 404 }) }
  })
  return { workspace, start, running: () => pending.size > 0, busy: (id: string) => pending.has(id), stop: () => { for (const controller of pending.values()) controller.abort() } }
}
