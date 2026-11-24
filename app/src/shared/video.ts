export type VideoOptions = { depth: 'detailed' | 'quick' | 'transcript'; visuals: boolean; maxFrames: number; language: string; notes: string; links: string; vault: boolean; mail: boolean }
export const defaultVideoOptions: VideoOptions = { depth: 'detailed', visuals: true, maxFrames: 24, language: '한국어', notes: '', links: '', vault: false, mail: false }
export function videoOptions(raw?: Partial<VideoOptions>): VideoOptions {
  const s = (x: unknown, max: number) => typeof x === 'string' ? x.trim().slice(0, max) : ''
  return { depth: raw?.depth === 'quick' || raw?.depth === 'transcript' ? raw.depth : 'detailed', visuals: raw?.visuals !== false,
    maxFrames: Math.min(96, Math.max(4, Math.round(Number(raw?.maxFrames) || 24))), language: s(raw?.language, 60) || '한국어', notes: s(raw?.notes, 30000), links: s(raw?.links, 6000), vault: !!raw?.vault, mail: !!raw?.mail }
}
export type VideoMetadata = { url: string; videoId: string; title: string; channel?: string; uploadDate?: string; durationMs: number; startMs: number; endMs: number; transcriptSource: string; captionLanguage?: string; captionAutomatic?: boolean }
export type VideoTurn = { id: string; startMs: number; endMs: number; text: string }
export type VideoFrame = { id: string; atMs: number; file: string; sha256: string; kind: 'question' | 'chart' | 'slide' | 'demo' | 'other'; text: string; description: string; score: number; hidden?: boolean }
export type VideoParagraph = { text: string; refs: string[] }
export type VideoTopic = { id: string; title: string; paragraphs: VideoParagraph[]; frameIds: string[] }
export type VideoDocument = { keyPoints: VideoParagraph[]; topics: VideoTopic[]; questions: { id: string; question: string; category?: 'identity' | 'meaning' | 'value'; refs?: string[]; answer?: string }[] }
export type ResearchSource = { id: string; title: string; url: string; accessedAt: string; publishedAt?: string; sha256: string; text: string }
export type VideoResearch = { id: string; topic: string; phase: 'queued' | 'searching' | 'writing' | 'ready' | 'partial' | 'failed' | 'cancelled'; message: string; queries: string[]; sources: ResearchSource[]; markdown?: string; createdAt: number; model?: string; appended?: boolean }
export type VideoState = { transcriptReady?: boolean; import?: { jobId: string; stage: import('./imports').ImportStage; message: string }; schemaVersion: 1; meetingId: string; phase: 'idle' | 'queued' | 'downloading' | 'frames' | 'reading' | 'organizing' | 'checking' | 'ready' | 'partial' | 'questions' | 'failed' | 'cancelled' | 'interrupted'; message: string; options: VideoOptions; metadata: VideoMetadata; frames: VideoFrame[]; document?: VideoDocument; research: VideoResearch[]; warnings: string[]; checks: string[]; candidateCount: number; sampledCount: number; aiCalls: number; model?: string; updatedAt: number }
export const VIDEO_ASSET = /^frame-[a-f0-9]{16}\.jpg$/
export function videoAssetUrl(meetingId: string, file: string) { return `yogurt-video://${meetingId}/${file}` }
export function videoTime(ms: number) { const sec = Math.floor(ms / 1000); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` }
export function videoTimeUrl(url: string, ms: number) { const u = new URL(url); u.searchParams.set('t', `${Math.floor(ms / 1000)}s`); return u.href }
