import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/main/store'
import { defaultVideoOptions, videoOptions, videoTimeUrl } from '../src/shared/video'
import type { VideoMetadata, VideoFrame, VideoTurn } from '../src/shared/video'
import { evenly, representativeFrames, renderVideoDocument, turnBatches, validateDocument, hash } from '../src/main/video/document'
import { VideoWorkspace } from '../src/main/video'
import { investigate, searchUrls } from '../src/main/video/research'
import type { Llm } from '../src/main/notes/enhance'
vi.mock('electron', () => ({ app: {} }))
vi.mock('../src/main/video/media', () => ({ ensureVideo: vi.fn(async () => '/cached/video.mp4'), candidates: vi.fn(async () => ({ frames: [], sampled: 30, total: 0 })), contactSheet: vi.fn(), extractFrame: vi.fn() }))
import * as media from '../src/main/video/media'
const dirs: string[] = [], stores: Store[] = []
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); vi.clearAllMocks() })
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'video-test-')); dirs.push(d); return d }
const meta: VideoMetadata = { url: 'https://www.youtube.com/watch?v=abcdefghijk', videoId: 'abcdefghijk', title: '한국어 English 강의', channel: '채널', durationMs: 600000, startMs: 90000, endMs: 120000, transcriptSource: '로컬 Whisper' }
const turns: VideoTurn[] = [{ id: 'T1', startMs: 90000, endMs: 100000, text: '상관관계를 인과관계로 해석하지 않습니다.' }]
const frames: VideoFrame[] = [{ id: 'V91000', atMs: 91000, file: 'frame-1234567890abcdef.jpg', sha256: '', kind: 'question', text: 'Q. 인과관계인가요?', description: '화면 질문', score: 10 }]
const raw = () => ({ coverage:[{sourceTopicId:'topic-0-1',finalTopicIndex:0}], keyPoints: [{ text: '상관과 인과를 구별합니다.', refs: ['T1'] }], topics: [{ title: '상관과 인과', paragraphs: [{ text: '인과로 단정하지 않는다는 조건을 강조합니다.', refs: ['T1', 'V91000'] }], frameIds: ['V91000'] }], questions: [] })
describe('evidence and export document contracts', () => {
  it('owns original timeline links and real asset paths, never invented images', () => {
    const doc = validateDocument(raw(), turns, frames), md = renderVideoDocument(doc, meta, turns, frames, defaultVideoOptions, [])
    expect(md).not.toContain('t=90s'); expect(md).toContain('assets/frame-1234567890abcdef.jpg'); expect(md).toContain('화면에 표시된 글'); expect(md).toContain('인과로 단정하지 않는다는 조건')
    expect(renderVideoDocument(doc, meta, turns, frames, defaultVideoOptions, [], true)).toContain('t=90s')
    expect(videoTimeUrl(meta.url, 90600)).toContain('t=90s')
    expect(renderVideoDocument(doc, meta, turns, [{ ...frames[0], hidden: true }], defaultVideoOptions, [])).not.toContain('![')
  })
  it('rejects hallucinated references and model-invented image paths', () => {
    const invalid = raw(); invalid.topics[0].paragraphs[0].refs = ['T999']; expect(() => validateDocument(invalid, turns, frames)).toThrow('존재하지 않는')
    invalid.topics[0].paragraphs[0] = { text: '![가짜](file:///secret)', refs: ['T1'] }; expect(() => validateDocument(invalid, turns, frames)).toThrow('검증되지 않은')
  })
  it('keeps the complete end of long source and distributes visual budget to the end', () => {
    const source = Array.from({ length: 40 }, (_, n) => ({ ...turns[0], id: `T${n}`, text: '원문'.repeat(1000) }))
    const batches = turnBatches(source, 4500); expect(batches.flat()).toEqual(source)
    expect(evenly(source, 4).map(t => t.id)).toEqual(['T0', 'T13', 'T26', 'T39'])
    expect(videoOptions({ maxFrames: 999, notes: 'a'.repeat(40000) }).maxFrames).toBe(96)
  })
  it('asks for concrete source clarification instead of broad research explanations',()=>{
    const input={...raw(),questions:[{question:'AI가 왜 인류의 가장 큰 변화인가요?'},{question:'T1의 지칭 대상은 누구인가요?',category:'identity',refs:['T1']},{question:'없는 발언 확인',category:'meaning',refs:['T999']}]}
    const document=validateDocument(input,turns,frames)
    expect(document.questions).toHaveLength(1);expect(document.questions[0].question).toContain('지칭 대상')
  })
  it('retains high-value screens while covering the beginning and end',()=>{
    const frames=Array.from({length:12},(_,n)=>({atMs:n*1000,score:n===6?10:1})),chosen=representativeFrames(frames,4)
    expect(chosen.map(f=>f.atMs)).toContain(6000);expect(chosen[0].atMs).toBe(0);expect(chosen.at(-1)?.atMs).toBe(11000);expect(chosen).toHaveLength(4)
  })
})
describe('persisted video pipeline', () => {
  function fixture() {
    const root = temp(), store = new Store(join(root, 'test.db')); stores.push(store)
    const m = store.createMeeting({ title: meta.title, startedAt: 1, endedAt: 2, state: 'stopped', eventId: null, app: null, attendees: [] }), dir = join(root, 'meetings', m.id)
    mkdirSync(join(dir, 'original'), { recursive: true }); writeFileSync(join(dir, 'import-source.json'), JSON.stringify({ url: meta.url, start: 90, end: 120, transcriptSource: 'local-asr' })); writeFileSync(join(dir, 'original/youtube.info.json'), JSON.stringify({ title: meta.title, duration: 600, channel: '채널', upload_date: '20261124' }))
    store.addSegments([{ meetingId: m.id, startMs: 0, endMs: 10000, text: turns[0].text, track: 'them', speaker: null }])
    const changed = vi.fn(), workspace = new VideoWorkspace({ root, store, changed, modelKey: () => 'configured-model-xhigh' })
    const llm: Llm = { contextSize: 200000, count: async () => [100], chat: vi.fn(async () => JSON.stringify({ ...raw(), topics: [{ ...raw().topics[0], paragraphs: [{ text: '상관관계가 인과관계를 뜻하지는 않습니다.', refs: ['T1'] }], frameIds: [] }] })) }
    return { root, store, m, dir, workspace, changed, llm }
  }
  it('persists source metadata, uses original offset, caches checked drafts and keeps previous editor text', async () => {
    const f = fixture(); f.workspace.configure(f.m.id, { visuals: false }); f.store.setNotes(f.m.id, { enhanced: '사용자가 편집한 원문', edited: true })
    const md = await f.workspace.run(f.m.id, f.llm, new AbortController().signal)
    expect(md).not.toContain('t=90s'); expect(f.llm.chat).toHaveBeenCalledTimes(3); expect(f.store.notes(f.m.id).enhanced).toBe('사용자가 편집한 원문')
    await f.workspace.run(f.m.id, f.llm, new AbortController().signal); expect(f.llm.chat).toHaveBeenCalledTimes(3)
    const reopened = new VideoWorkspace({ root: f.root, store: f.store, changed: () => {}, modelKey: () => 'configured-model-xhigh' })
    expect(reopened.get(f.m.id)?.metadata.uploadDate).toBe('2026-11-24'); expect(reopened.get(f.m.id)?.phase).toBe('ready')
  })
  it('keeps usable transcript notes when visual download fails', async () => {
    const f = fixture(); vi.mocked(media.ensureVideo).mockRejectedValueOnce(new Error('HTTP429 video'))
    const md = await f.workspace.run(f.m.id, f.llm, new AbortController().signal)
    expect(md).toContain('상관관계'); expect(f.workspace.get(f.m.id)?.phase).toBe('partial'); expect(f.workspace.get(f.m.id)?.warnings[0]).toContain('HTTP429')
  })
  it('reads real selected full-size frames and registers only verified asset hashes', async () => {
    const f = fixture(), path = join(f.root, 'input.jpg'); writeFileSync(path, 'real test image bytes')
    vi.mocked(media.candidates).mockResolvedValueOnce({ frames: [{ atMs: 91000, path }], total: 1, sampled: 30 }); vi.mocked(media.contactSheet).mockResolvedValueOnce(path)
    vi.mocked(media.extractFrame).mockImplementationOnce(async (_v, _at, dir) => { mkdirSync(dir, { recursive: true }); const dest = join(dir, frames[0].file); writeFileSync(dest, readFileSync(path)); return { path: dest, file: frames[0].file, sha256: hash(readFileSync(dest)) } })
    vi.mocked(f.llm.chat).mockImplementation(async prompt => JSON.stringify(prompt.includes('contact sheet') ? { frames: [{ index: 0, kind: 'question', score: 10 }] } : prompt.includes('Read these real') ? { frames: [{ id: 'V91000', text: 'Q. 인과관계인가요?', description: '화면만의 질문' }] } : raw()))
    const md = await f.workspace.run(f.m.id, f.llm, new AbortController().signal)
    expect(md).toContain('화면만의 질문'); expect(f.workspace.asset(f.m.id, frames[0].file)).toBeTruthy(); expect(f.workspace.asset(f.m.id, '../input.jpg')).toBeUndefined()
    writeFileSync(f.workspace.asset(f.m.id, frames[0].file)!, 'tampered'); expect(f.workspace.asset(f.m.id, frames[0].file)).toBeUndefined()
  })
  it('refuses incomplete final topic coverage and preserves the prior document',async()=>{
    const f=fixture();f.workspace.configure(f.m.id,{visuals:false});f.store.setNotes(f.m.id,{enhanced:'기존 편집',edited:true})
    vi.mocked(f.llm.chat).mockImplementation(async prompt=>JSON.stringify({...raw(),coverage:prompt.includes('ONE coherent')?[]:raw().coverage,topics:[{...raw().topics[0],paragraphs:[{text:'근거 문장',refs:['T1']}],frameIds:[]}]}))
    await expect(f.workspace.run(f.m.id,f.llm,new AbortController().signal)).rejects.toThrow('일부 주제')
    expect(f.store.notes(f.m.id).enhanced).toBe('기존 편집')
  })
  it('normalizes untouched cached rolling captions but preserves edited transcripts and evidence snapshots',async()=>{
    const f=fixture(),segments=f.store.segments(f.m.id)
    writeFileSync(join(f.dir,'import-transcript.json'),JSON.stringify({kind:'youtube-captions',source:'youtube.ko.vtt',turns:segments}))
    writeFileSync(join(f.dir,'original/youtube.ko.vtt'),'WEBVTT\n\n00:01:30.000 --> 00:01:32.000\n \n복구된<00:01:31.000><c> 설명</c>\n\n00:01:32.000 --> 00:01:32.010\n복구된 설명\n')
    f.workspace.configure(f.m.id,{visuals:false})
    await f.workspace.run(f.m.id,f.llm,new AbortController().signal)
    expect(f.workspace.get(f.m.id)?.evidenceTurns).toEqual([{id:'T1',text:'복구된 설명',startMs:90000,endMs:92000}])
    expect(f.store.segments(f.m.id)[0].text).toBe(turns[0].text)
    writeFileSync(join(f.dir,'import-transcript.json'),JSON.stringify({kind:'youtube-captions',source:'youtube.ko.vtt',turns:[{...segments[0],text:'수정 전 내용'}]}))
    await f.workspace.run(f.m.id,f.llm,new AbortController().signal)
    expect(f.workspace.get(f.m.id)?.evidenceTurns?.[0].text).toBe(turns[0].text)
  })
  it('cancellation starts no new calls and records an interrupted run', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort()
    await expect(f.workspace.run(f.m.id, f.llm, controller.signal)).rejects.toThrow('중단'); expect(f.llm.chat).not.toHaveBeenCalled(); expect(f.workspace.get(f.m.id)?.phase).toBe('cancelled')
  })
})
describe('deep research uses read receipts', () => {
  const run = () => ({ id: 'research', topic: '상관과 인과', phase: 'queued' as const, message: '', queries: [], sources: [], createdAt: 1 })
  it('separates original video from cited independent sources', async () => {
    const r = run(), llm: Llm = { contextSize: 200000, count: async () => [1], chat: vi.fn().mockResolvedValueOnce(JSON.stringify({ queries: ['인과 공식 논문', '인과 한계 반론'] })).mockResolvedValueOnce(JSON.stringify({ sections: [{ title: '근거와 한계', paragraphs: [{ text: '영상 주장의 적용 조건을 구별합니다.', sourceIds: ['R1'] }] }], remainingQuestions: ['후속 연구가 필요한가?'] })) }
    await investigate(r, '원래 영상 주장', llm, new AbortController().signal, () => {}, { search: async () => ['https://example.org/paper'], read: async (url, id) => ({ id, title: '실제 읽은 논문', url, text: '논문 원문', accessedAt: '2026-11-24', sha256: 'hash' }) })
    expect((r as any).markdown).toContain('https://example.org/paper'); expect((r as any).markdown).toContain('원래 주장과 구분'); expect(r.sources).toHaveLength(1)
  })
  it('never presents a search snippet as a read paper', async () => {
    const r = run(), llm: Llm = { contextSize: 20000, count: async () => [1], chat: vi.fn(async () => '{"queries":["query"]}') }
    await expect(investigate(r, '', llm, new AbortController().signal, () => {}, { search: async () => ['https://example.org/denied'], read: async () => { throw Error('403') } })).rejects.toThrow('원문을 찾지 못했습니다'); expect(r.phase).toBe('failed'); expect(llm.chat).toHaveBeenCalledOnce()
  })
  it('distributes the reading budget across all questions including counterevidence',async()=>{
    const r=run(),queries=['definition','support','primary','limits','counter','recent'],search=vi.fn(async(q:string)=>Array.from({length:5},(_,n)=>`https://example.org/${q}/${n}`))
    const llm:Llm={contextSize:200000,count:async()=>[1],chat:vi.fn().mockResolvedValueOnce(JSON.stringify({queries})).mockResolvedValueOnce(JSON.stringify({sections:[{title:'비교',paragraphs:[{text:'읽은 근거를 비교한다.',sourceIds:['R1']}]}]}))}
    await investigate(r,'',llm,new AbortController().signal,()=>{},{search,read:async(url,id)=>({id,url,title:'읽은 원문',text:'본문',accessedAt:'2026-11-24',sha256:'hash'})})
    expect(search).toHaveBeenCalledTimes(6);expect(r.sources).toHaveLength(8);expect(new Set((r.sources as any[]).map(s=>s.url.split('/')[3])).size).toBe(6)
  })
  it('extracts direct and redirected public result URLs', () => { expect(searchUrls('<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fpaper">paper</a>')).toEqual(['https://example.org/paper']) })
})
