import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Store } from '../store'
import type { Llm } from '../notes/enhance'
import { defaultVideoOptions, videoOptions, VIDEO_ASSET, type VideoState, type VideoOptions, type VideoTurn, type VideoFrame, type VideoDocument, type VideoResearch } from '../../shared/video'
import { youtubeUrl } from '../../shared/imports'
import { DATA, representativeFrames, hash, json, renderVideoDocument, turnBatches, validateDocument } from './document'
import { candidates, contactSheet, ensureVideo, extractFrame } from './media'
import { investigate } from './research'
import type { Evidence } from '../../shared/organizer'
type Dependencies = { root: string; store: Pick<Store, 'meeting' | 'notes' | 'segments' | 'setNotes'>; changed: (s: VideoState) => void; context?: (id: string, options: VideoOptions, signal: AbortSignal) => Promise<Evidence[]>; modelKey: () => string }
const terminal = new Set(['idle', 'ready', 'partial', 'questions', 'failed', 'cancelled', 'interrupted'])
export class VideoWorkspace {
  private states = new Map<string, VideoState>()
  constructor(private p: Dependencies) {}
  dir(id: string) { if (!/^[a-f0-9-]{36}$/.test(id) || !this.p.store.meeting(id)) throw new Error('기록을 찾지 못했습니다.'); return join(this.p.root, 'meetings', id, 'video') }
  get(id: string): VideoState | undefined {
    if (this.states.has(id)) return structuredClone(this.states.get(id)!)
    const dir = this.dir(id); let state: VideoState
    try { state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')); if (!terminal.has(state.phase)) { state.phase = 'interrupted'; state.message = '이전 작업이 중단됐습니다. 저장한 단계부터 다시 시작할 수 있습니다.' } }
    catch {
      let source: any, info: any
      try { source = JSON.parse(readFileSync(join(dir, '../import-source.json'), 'utf8')); info = JSON.parse(readFileSync(join(dir, '../original/youtube.info.json'), 'utf8')) } catch { return }
      if (!source.url) return
      const url = youtubeUrl(source.url), meeting = this.p.store.meeting(id)!
      const duration = Number(info.duration) * 1000 || Number(meeting.durationMs) + (Number(source.start) || 0) * 1000
      state = { schemaVersion: 1, meetingId: id, phase: 'idle', message: '전사와 화면 자료를 연결해 영상 정리본을 만들 수 있습니다.', options: { ...defaultVideoOptions },
        metadata: { url, videoId: new URL(url).searchParams.get('v')!, title: String(info.title || meeting.title), channel: typeof info.channel === 'string' ? info.channel : undefined, uploadDate: /^\d{8}$/.test(info.upload_date) ? info.upload_date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3') : undefined, durationMs: duration, startMs: (Number(source.start) || 0) * 1000, endMs: Math.min(source.end ? Number(source.end) * 1000 : duration, duration), transcriptSource: source.transcriptSource === 'youtube-captions' ? 'YouTube 자막' : '로컬 Whisper', captionLanguage: source.captionLanguage, captionAutomatic: source.captionAutomatic },
        frames: [], research: [], warnings: [], checks: [], candidateCount: 0, sampledCount: 0, aiCalls: 0, updatedAt: Date.now() }
    }
    for(const run of state.research)if(['queued','searching','writing'].includes(run.phase)){run.phase='failed';run.message='이전 조사가 중단됐습니다. 같은 주제로 다시 시작하면 읽은 자료를 재사용합니다.'}
    this.states.set(id, state); return structuredClone(state)
  }
  save(state: VideoState) { const dir = this.dir(state.meetingId); mkdirSync(dir, { recursive: true, mode: 0o700 }); state.updatedAt = Date.now(); this.states.set(state.meetingId, structuredClone(state)); writeFileSync(join(dir, 'state.json.tmp'), JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(join(dir, 'state.json.tmp'), join(dir, 'state.json')); this.p.changed(structuredClone(state)) }
  configure(id: string, options: Partial<VideoOptions>) { const s = this.get(id); if (!s) throw new Error('YouTube 원본을 찾지 못했습니다.'); s.options = videoOptions(options); this.save(s); return s }
  stage(id: string, phase: VideoState['phase'], message: string) { const s = this.get(id); if (!s) throw new Error('YouTube 원본을 찾지 못했습니다.'); s.phase = phase; s.message = message; this.save(s); return s }
  private turns(s: VideoState): VideoTurn[] { return this.p.store.segments(s.meetingId).filter(t => t.text.trim()).map((t, i) => ({ id: `T${i + 1}`, text: t.text, startMs: t.startMs + s.metadata.startMs, endMs: t.endMs + s.metadata.startMs })) }
  private async cached<T>(s: VideoState, key: unknown, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const dir = join(this.dir(s.meetingId), 'cache'); mkdirSync(dir, { recursive: true }); const path = join(dir, hash(JSON.stringify([key, s.model, 'video-prompt-v1'])) + '.json')
    if (signal.aborted) throw new Error('작업을 중단했습니다.')
    try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { /* Compute only the missing stage. */ }
    const value = await run(); if (signal.aborted) throw new Error('작업을 중단했습니다.')
    writeFileSync(path + '.tmp', JSON.stringify(value), { mode: 0o600 }); renameSync(path + '.tmp', path); return value
  }
  private register(id: string, file: string, sha256: string) { const path = join(this.dir(id), 'assets.json'); let entries: Record<string, string> = {}; try { entries = JSON.parse(readFileSync(path, 'utf8')) } catch { /* new registry */ }; entries[file] = sha256; writeFileSync(path + '.tmp', JSON.stringify(entries), { mode: 0o600 }); renameSync(path + '.tmp', path) }
  asset(id: string, file: string): string | undefined {
    if (!VIDEO_ASSET.test(file)) return
    try { const dir = this.dir(id), registry = JSON.parse(readFileSync(join(dir, 'assets.json'), 'utf8')); if (typeof registry[file] !== 'string') return; const base = realpathSync(join(dir, 'frames')), path = realpathSync(join(base, file)), rel = relative(base, path); if (rel.startsWith('..') || isAbsolute(rel) || !statSync(path).isFile() || hash(readFileSync(path)) !== registry[file]) return; return path } catch { return }
  }
  async run(id: string, llm: Llm, signal: AbortSignal): Promise<string> {
    const s = this.get(id); if (!s) throw new Error('YouTube 원본을 찾지 못했습니다.')
    const turns = this.turns(s); if (!turns.length) throw new Error('전사 원문이 없습니다. 먼저 가져오기를 완료하세요.')
    s.model = this.p.modelKey(); s.warnings = []; s.checks = []; s.aiCalls = 0
    const stage = (phase: VideoState['phase'], message: string) => { if (signal.aborted) throw new Error('작업을 중단했습니다.'); s.phase = phase; s.message = message; this.save(s) }
    const ask = async (prompt: string, images?: string[], maxTokens = 10000) => {
      if (signal.aborted) throw new Error('작업을 중단했습니다.')
      const [count] = await llm.count([prompt]); if (count + maxTokens > llm.contextSize) throw new Error('모델 문맥 공간이 부족합니다. 영상 구간을 나눠 주세요.')
      s.aiCalls++; this.save(s); return json(await llm.chat(prompt, () => {}, { images, maxTokens, temperature: 0.1 }))
    }
    try {
      if (s.options.depth === 'transcript') throw new Error('전사만 선택한 기록입니다. 정리 깊이를 선택하세요.')
      if (s.options.visuals) {
        stage('downloading', '화면 분석용 영상을 준비하고 있습니다. 전사 원문은 보존됩니다.')
        try {
          const video = await ensureVideo(join(this.dir(id), 'media'), s.metadata, signal)
          stage('frames', '화면 변화와 주기 표본에서 질문·표·슬라이드 후보를 찾고 있습니다.')
          const sampled = await candidates(video, join(this.dir(id), 'candidates'), s.metadata, signal)
          s.sampledCount = sampled.sampled; s.candidateCount = sampled.total
          if (sampled.total > sampled.frames.length) s.warnings.push(`화면 후보 ${sampled.total}개 중 전체 시간에 분산한 ${sampled.frames.length}개를 분류했습니다.`)
          const ranked: { atMs: number; kind: VideoFrame['kind']; score: number }[] = []
          for (let n = 0; n < sampled.frames.length; n += 16) {
            stage('reading', `화면 후보 ${n + 1}–${Math.min(n + 16, sampled.frames.length)} / ${sampled.frames.length}개를 분류하고 있습니다.`)
            const batch = sampled.frames.slice(n, n + 16), sheet = await contactSheet(batch, join(this.dir(id), 'sheets'), signal)
            const selected = await this.cached<any>(s, ['select', batch.map(c => [c.atMs, hash(readFileSync(c.path))])], signal, () => ask(`${DATA}\nThis image is a 4-column by 4-row contact sheet of real video frames. Index is 0-based row-major; only ${batch.length} cells are valid. Select useful SCREEN questions, charts, slides or demo steps. Ignore faces, logos and ordinary talking-head captions repeating speech. Return JSON {frames:[{index:number,kind:question|chart|slide|demo,score:1-10}]}. Classify only; do not infer small unreadable text.`, [sheet], 3000))
            for (const item of Array.isArray(selected.frames) ? selected.frames : []) if (Number.isInteger(item.index) && batch[item.index] && ['question', 'chart', 'slide', 'demo'].includes(item.kind)) ranked.push({ atMs: batch[item.index].atMs, kind: item.kind, score: Math.max(1, Math.min(10, Number(item.score) || 1)) })
          }
          // Keep temporal coverage as well as high-scoring questions; never truncate the last half of a long video.
          const unique = [...new Map(ranked.sort((a, b) => a.atMs - b.atMs).map(c => [c.atMs, c])).values()]
          const chosen = representativeFrames(unique,s.options.maxFrames)
          const frames: VideoFrame[] = []
          for (let n = 0; n < chosen.length; n += 3) {
            stage('reading', `대표 화면 ${n + 1}–${Math.min(n + 3, chosen.length)} / ${chosen.length}개에서 실제 글과 도표를 읽고 있습니다.`)
            const batch = chosen.slice(n, n + 3), files: {atMs:number;kind:VideoFrame['kind'];score:number;file:string;path:string;sha256:string;id:string}[] = []
            for (const candidate of batch) { const f = await extractFrame(video, candidate.atMs, join(this.dir(id), 'frames'), signal); this.register(id, f.file, f.sha256); files.push({ ...candidate, ...f, id: `V${candidate.atMs}` }) }
            const read = await this.cached<any>(s, ['read', files.map(f => [f.id, f.sha256])], signal, () => ask(`${DATA}\nRead these real video frames faithfully. Images are in this ID order: ${files.map(f => f.id).join(', ')}. Return JSON {frames:[{id,text,description}]}. Preserve legible Korean/English, chart axes, units and values. Mark unreadable parts explicitly; never estimate a blurred number. Description explains why the screen matters, without asserting a speaker said it.`, files.map(f => f.path), 7000))
            for (const f of files) { const item = Array.isArray(read.frames) ? read.frames.find((r: any) => r.id === f.id) : undefined; if (!item || typeof item.text !== 'string' || typeof item.description !== 'string') throw new Error('대표 화면 판독 결과와 실제 프레임을 대응하지 못했습니다.'); frames.push({ id: f.id, atMs: f.atMs, file: f.file, sha256: f.sha256, kind: f.kind, score: f.score, text: item.text.slice(0, 12000), description: item.description.slice(0, 1200) }) }
          }
          s.frames = frames; if (!frames.length) s.warnings.push('표본에서 별도 본문 이미지로 넣을 질문·도표를 확인하지 못했습니다.')
        } catch (error) { if (signal.aborted) throw error; s.frames = []; s.warnings.push('화면 분석을 완료하지 못했습니다: ' + (error instanceof Error ? error.message : String(error))); this.save(s) }
      } else { s.frames = []; s.candidateCount = 0; s.sampledCount = 0 }
      stage('organizing', '원문과 화면 근거를 연결해 주제별 상세 정리를 만들고 있습니다.')
      const context = await this.p.context?.(id, s.options, signal) || []
      for(const e of context.filter(e=>e.imagePath)) {const read=await this.cached<any>(s,['context-image',hash(readFileSync(e.imagePath!))],signal,()=>ask(`${DATA}\nRead this user-supplied context image faithfully. Return JSON {text:string}. Mark illegible text; preserve labels and diagram meaning.`,[e.imagePath!],8000));e.text=typeof read.text==='string'?read.text:''}
      const contextText = JSON.stringify(context.map(e => ({ id: `C-${e.id}`, title: e.title, text: e.text.slice(0, 12000) }))).slice(0, 50000)
      const batches = turnBatches(turns, Math.min(24000, Math.max(3000, Math.floor(llm.contextSize * 0.25))))
      const doc: VideoDocument = { keyPoints: [], topics: [], questions: [] }
      for (const [n, batch] of batches.entries()) {
        stage('organizing', `원문 ${n + 1}/${batches.length} 구간을 빠짐없이 정리하고 있습니다.`)
        const nearby = s.frames.filter(f => f.atMs >= batch[0].startMs - 20000 && f.atMs <= batch.at(-1)!.endMs + 10000)
        const input = { metadata: s.metadata, options: s.options, transcript: batch, frames: nearby, context: contextText, priorAnswers: s.document?.questions.filter(q => q.answer) || [] }
        const draft = await this.cached<VideoDocument>(s, ['draft', input], signal, async () => validateDocument(await ask(`${DATA}\nWrite a ${s.options.depth === 'quick' ? 'concise but accurate' : 'detailed, substantive'} video study note in ${s.options.language}. Cover ALL topics in this supplied time range, including its end. Connect screen-only questions to later answers only when timing AND content support it. Keep reasoning, examples, counterarguments, numbers, conditions and limitations. Do not collapse a long interview into 3 short bullets. Context may clarify terms but cannot replace what the video says. Return JSON {keyPoints:[{text,refs:string[]}],topics:[{title,paragraphs:[{text,refs:string[]}],frameIds:string[]}],questions:[{question,category:identity|meaning|value,refs:string[]}]}. Paragraphs can contain Markdown emphasis/lists/tables but NO links/images. Every paragraph cites exact T or V IDs supplied; frameIds selects relevant real screens. Default questions:[]. Ask at most8 concrete clarification questions ONLY about an unclear identity, transcription meaning, or conflicting value in supplied source, with category identity|meaning|value and exact refs. Ask only when the user can clarify the recording context. Do not ask general research questions about why a claim is true, missing study methodology, future impacts, or arguments beyond this excerpt; those belong to optional deep research. No style questions. No question is needed if evidence resolves it.\nINPUT:${JSON.stringify(input)}`, undefined, 14000), batch, nearby, n))
        stage('checking', `정리 ${n + 1}/${batches.length} 구간의 숫자·부정·조건과 화면 인용을 검수하고 있습니다.`)
        const checked = await this.cached<VideoDocument>(s, ['check', input, draft], signal, async () => validateDocument(await ask(`${DATA}\nIndependently audit and revise this WHOLE proposed video note against original turns/screens. Preserve substantial detail, ensure the final topics are covered, correct unsupported numbers/negation/conditions, remove unsupported attributions. Screen text must not be presented as a spoken quote. Do not invent extra context. Return the SAME JSON document schema {keyPoints:[{text,refs}],topics:[{title,paragraphs:[{text,refs}],frameIds}],questions:[{question,category:identity|meaning|value,refs:string[]}]}. Keep only supplied T/V refs. Questions default to []; retain only concrete user-answerable identity/transcription-meaning/conflicting-value clarifications with category identity|meaning|value and refs. Never ask the user to supply broad scientific explanations or future research. Output in ${s.options.language}.\nSOURCE:${JSON.stringify(input)}\nDRAFT:${JSON.stringify(draft)}`, undefined, 14000), batch, nearby, n))
        doc.keyPoints.push(...checked.keyPoints); doc.topics.push(...checked.topics); doc.questions.push(...checked.questions)
      }
      if (doc.keyPoints.length > 5) {
        const summary = await this.cached<any>(s, ['keypoints', doc.keyPoints], signal, () => ask(`${DATA}\nChoose/combine 3-5 central claims covering the whole video, retaining exact valid refs. Return JSON {keyPoints:[{text,refs}]} in ${s.options.language}. No links.\nCANDIDATES:${JSON.stringify(doc.keyPoints)}`, undefined, 3000))
        doc.keyPoints = validateDocument({ ...summary, topics: [doc.topics[0]], questions: [] }, turns, s.frames).keyPoints
      }
      doc.questions = doc.questions.filter(q=>q.category&&q.refs?.length).slice(0, 8).map((q, n) => ({ ...q, id: `Q${n + 1}`, answer: s.document?.questions.find(old => old.question === q.question)?.answer }))
      s.document = doc; s.checks = ['문단의 T/V 근거 ID와 이미지 등록 여부 검사', `원문 ${batches.length}구간별 별도 AI 검수 완료 · 사실 정확도의 자동 보장은 아님`]
      s.phase = doc.questions.some(q => !q.answer) ? 'questions' : s.warnings.length ? 'partial' : 'ready'; s.message = s.phase === 'questions' ? '정리본이 준비됐습니다. 남은 중요한 확인 사항만 답해 주세요.' : s.warnings.length ? '전사 정리는 완료했습니다. 화면 처리 범위와 알림을 확인하세요.' : '전사·화면 근거를 연결한 영상 정리본이 준비됐습니다.'
      this.save(s); return renderVideoDocument(doc, s.metadata, turns, s.frames, s.options, s.warnings)
    } catch (error) { s.phase = signal.aborted ? 'cancelled' : 'failed'; s.message = error instanceof Error ? error.message : String(error); this.save(s); throw error }
  }
  answer(id: string, answers: Record<string, string>) { const s = this.get(id); if (!s?.document) throw new Error('확인할 정리본이 없습니다.'); for (const q of s.document.questions) if (typeof answers[q.id] === 'string') q.answer = answers[q.id].slice(0, 2000).trim(); s.phase = s.document.questions.some(q => !q.answer) ? 'questions' : s.warnings.length ? 'partial' : 'ready'; this.save(s); return s }
  editFrame(id: string, frameId: string, patch: { description?: string; hidden?: boolean }) { const s = this.get(id), f = s?.frames.find(f => f.id === frameId); if (!s || !f) throw new Error('프레임을 찾지 못했습니다.'); if (typeof patch.description === 'string') f.description = patch.description.slice(0, 1200); if (typeof patch.hidden === 'boolean') f.hidden = patch.hidden; this.save(s); return s }
  render(id: string) { const s = this.get(id); if (!s?.document) throw new Error('영상 정리본이 없습니다.'); return renderVideoDocument(s.document, s.metadata, this.turns(s), s.frames, s.options, s.warnings) }
  newResearch(id: string, topic: string) { const s = this.get(id); if (!s?.document) throw new Error('영상 정리 후 조사할 수 있습니다.'); const value=topic.trim().slice(0,500);if(!value)throw new Error('조사 주제를 입력하세요.');const prior=s.research.find(r=>r.topic===value&&['failed','cancelled'].includes(r.phase));if(prior){prior.phase='queued';prior.message='저장된 검색 질문과 읽은 자료를 재사용해 다시 시작합니다.';this.save(s);return prior.id} const run: VideoResearch = { id: randomUUID(), topic:value, phase: 'queued', message: '조사를 기다립니다.', queries: [], sources: [], createdAt: Date.now(), model: this.p.modelKey() }; s.research.push(run); this.save(s); return run.id }
  async research(id: string, researchId: string, llm: Llm, signal: AbortSignal) { const s = this.get(id), run = s?.research.find(r => r.id === researchId); if (!s || !run) throw new Error('조사를 찾지 못했습니다.');
    const terms=run.topic.toLowerCase().split(/\s+/).filter(t=>t.length>1)
    const topics=s.document!.topics.filter(t=>t.title===run.topic||terms.some(term=>(t.title+' '+t.paragraphs.map(p=>p.text).join(' ')).toLowerCase().includes(term))).slice(0,4)
    const refs=new Set(topics.flatMap(t=>t.paragraphs.flatMap(p=>p.refs)))
    const original=JSON.stringify({title:s.metadata.title,url:s.metadata.url,transcript:this.turns(s).filter(t=>refs.has(t.id)),screens:s.frames.filter(f=>refs.has(f.id)).map(f=>({id:f.id,atMs:f.atMs,text:f.text})),note:topics.length?'선택한 주제의 공개 영상 원문만 제공':'영상에서 해당 주제를 대응시키지 못함. 사용자가 직접 요청한 공개 개념 조사'})
    await investigate(run, original, llm, signal, () => this.save(s)); return run }
}
