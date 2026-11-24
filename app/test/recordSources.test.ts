import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../src/main/store'
import { VideoSources } from '../src/main/imports/sources'
import { VideoWorkspace } from '../src/main/video'
vi.mock('electron', () => ({ app: {} }))
vi.mock('../src/main/video/media', () => ({}))
const roots: string[] = [], stores: Store[] = []
afterEach(() => { for (const s of stores.splice(0)) s.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'record-source-')); roots.push(root)
  const store = new Store(join(root, 'test.db')); stores.push(store)
  const meeting = (title = 'YouTube 영상', at = 1) => store.createMeeting({ title, startedAt: at, endedAt: at + 1, state: 'stopped', eventId: null, app: null, attendees: [] })
  const video = meeting(), recording = meeting('YouTube라고 말한 회의', 2)
  mkdirSync(join(root, 'imports'))
  const job = { id: 'bfadcccf-96f5-4b88-b965-2a7c735e2654', meetingId: video.id, title: '실제 영상', files: [], url: 'https://youtu.be/ADP3Wo47m6E', stage: 'transcribing', message: '로컬 전사 중', createdAt: 1, updatedAt: 1, start: 90 }
  const save = () => writeFileSync(join(root, 'imports', job.id + '.json'), JSON.stringify(job))
  save()
  const sources = new VideoSources(root), workspace = new VideoWorkspace({ root, store, sources, changed: () => {}, modelKey: () => 'test' })
  return { root, store, video, recording, job, save, sources, workspace, meeting }
}
it('recognizes an incomplete legacy job without provenance/info and never guesses from a title', () => {
  const f = fixture(), state = f.workspace.get(f.video.id)!
  expect(f.sources.ids()).toEqual([f.video.id]); expect(state.metadata.videoId).toBe('ADP3Wo47m6E')
  expect(state.metadata.transcriptSource).toBe('전사 준비 중'); expect(state.transcriptReady).toBe(false)
  expect(state.import?.stage).toBe('transcribing'); expect(Number.isFinite(state.metadata.durationMs)).toBe(true)
  expect(f.workspace.get(f.recording.id)).toBeUndefined()
})
it('refreshes cached metadata and readiness as the same job finishes, preserving options and edits', () => {
  const f = fixture(); f.workspace.configure(f.video.id, { visuals: false, notes: '사용자 맥락' })
  f.store.setNotes(f.video.id, { enhanced: '이전에 편집한 정리', edited: true })
  f.store.addSegments([{ meetingId: f.video.id, track: 'them', speaker: null, text: '한국어 English 발화', startMs: 0, endMs: 10000 }])
  expect(f.workspace.get(f.video.id)?.transcriptReady).toBe(false)
  f.job.stage = 'done'; f.save()
  const original = join(f.root, 'meetings', f.video.id, 'original'); mkdirSync(original, { recursive: true })
  writeFileSync(join(original, 'youtube.info.json'), JSON.stringify({ title: '완료된 영상 제목', duration: 1314, channel: '채널' }))
  const state = f.workspace.get(f.video.id)!
  expect(state.transcriptReady).toBe(true); expect(state.metadata.title).toBe('완료된 영상 제목')
  expect(state.metadata.startMs).toBe(90000); expect(state.metadata.endMs).toBe(1314000)
  expect(state.options.notes).toBe('사용자 맥락'); expect(state.options.visuals).toBe(false)
  expect(f.store.notes(f.video.id).enhanced).toBe('이전에 편집한 정리')
})
it('filters before pagination and composes with folder and trash filters', () => {
  const f = fixture(), other = f.meeting('다른 영상', 3), folder = f.store.createFolder('모음')
  for (const id of [f.video.id, f.recording.id, other.id]) f.store.addToFolder(folder.id, id)
  const idsFilter = { ids: [f.video.id, other.id], exclude: false }
  const first = f.store.meetingCards({ limit: 1, idsFilter }); expect(first[0].id).toBe(other.id)
  expect(f.store.meetingCards({ limit: 1, idsFilter, before: { at: first[0].startedAt, id: first[0].id } })[0].id).toBe(f.video.id)
  expect(f.store.meetingCards({ limit: 10, folder: folder.id, idsFilter: { ...idsFilter, exclude: true } }).map(m => m.id)).toEqual([f.recording.id])
  expect(f.store.meetingCards({ limit: 10, idsFilter: { ids: [], exclude: false } })).toEqual([])
  f.store.trashMeeting(other.id, 1)
  expect(f.store.meetingCards({ limit: 10, idsFilter }).map(m => m.id)).toEqual([f.video.id])
})
