import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
vi.mock('electron', () => ({ app: { on: vi.fn() }, ipcMain: { handle: vi.fn() }, dialog: {}, BrowserWindow: class {} }))
vi.mock('../src/main/imports/tools', () => ({ command: vi.fn(), mediaTool: (s: string) => s, mediaNode: () => 'node', ffmpegDecode: async function* () { yield new Float32Array(100) } }))
import { command } from '../src/main/imports/tools'
import { chooseCaption, downloadYouTube } from '../src/main/imports/youtube'
import { ImportManager } from '../src/main/imports'
import { Store } from '../src/main/store'

const dirs: string[] = []
const stores: Store[] = []
const temp = () => { const d = mkdtempSync(join(tmpdir(), 'yogurt-youtube-')); dirs.push(d); return d }
const info = { title: '한국어 질문이 있는 영상', subtitles: { ko: [{}], en: [{}] }, automatic_captions: { ko: [{}], 'ko-orig': [{}] } }
const cue = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n한국어 English\n'
beforeEach(() => { vi.mocked(command).mockReset() })
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const options = (directory: string) => ({ directory, url: 'https://www.youtube.com/watch?v=abcdefghijk', captions: true, signal: new AbortController().signal, onInfo: vi.fn(), onFallback: vi.fn(), onProgress: vi.fn() })

describe('YouTube captions and audio are independent acquisition paths', () => {
  it('requests one language and prefers manual captions within that language', () => {
    expect(chooseCaption(info)).toEqual({ language: 'ko', automatic: false })
    expect(chooseCaption({ subtitles: { en: [{}] }, automatic_captions: { ko: [{}] } })).toEqual({ language: 'ko', automatic: true })
    expect(chooseCaption({ subtitles: { live_chat: [{}], '../../outside': [{}] } })).toBeUndefined()
  })
  it('falls back once on 429, retains metadata, and never sends subtitle flags on audio download', async () => {
    const directory = temp(), o = options(directory)
    vi.mocked(command).mockImplementation(async (_binary, args) => {
      if (args.includes('--write-info-json')) writeFileSync(join(directory, 'youtube.info.json'), JSON.stringify(info))
      else if (args.includes('--write-subs')) throw new Error("Unable to download video subtitles for 'ko': HTTP Error 429")
      else if (args.includes('-f')) writeFileSync(join(directory, 'youtube.webm'), 'audio')
      return ''
    })
    expect(await downloadYouTube(o)).toEqual({ audio: join(directory, 'youtube.webm') })
    expect(o.onInfo).toHaveBeenCalledWith(info)
    expect(o.onFallback).toHaveBeenCalledOnce()
    expect(o.onFallback.mock.calls[0][0]).toContain('429')
    const calls = vi.mocked(command).mock.calls.map(c => c[1])
    expect(calls).toHaveLength(3)
    expect(calls[1][calls[1].indexOf('--sub-langs') + 1]).toBe('^ko$')
    expect(calls[1][calls[1].indexOf('--retries') + 1]).toBe('0')
    expect(calls[2]).toContain('--no-write-subs')
    expect(calls[2]).not.toContain('--write-subs')
  })
  it('imports valid cached captions without downloading or ASR', async () => {
    const directory = temp()
    writeFileSync(join(directory, 'youtube.info.json'), JSON.stringify(info))
    writeFileSync(join(directory, 'youtube.ko.vtt'), cue)
    const result = await downloadYouTube(options(directory))
    expect(result.track).toEqual({ language: 'ko', automatic: false })
    expect(result.transcript).toBe(join(directory, 'youtube.ko.vtt'))
    expect(command).not.toHaveBeenCalled()
  })
  it.each(['missing', 'malformed'])('falls back for %s subtitles', async kind => {
    const directory = temp(), o = options(directory)
    writeFileSync(join(directory, 'youtube.info.json'), JSON.stringify(kind === 'missing' ? { title: 'no captions' } : info))
    vi.mocked(command).mockImplementation(async (_b, args) => {
      if (args.includes('--write-subs')) writeFileSync(join(directory, 'youtube.ko.vtt'), 'invalid')
      if (args.includes('-f')) writeFileSync(join(directory, 'youtube.webm'), 'audio')
      return ''
    })
    expect((await downloadYouTube(o)).audio).toBeTruthy()
    expect(o.onFallback).toHaveBeenCalledOnce()
  })
  it('does not switch to audio after cancellation', async () => {
    const directory = temp(), controller = new AbortController(), o = { ...options(directory), signal: controller.signal }
    writeFileSync(join(directory, 'youtube.info.json'), JSON.stringify(info))
    vi.mocked(command).mockImplementation(async () => { controller.abort(); throw new Error('aborted') })
    await expect(downloadYouTube(o)).rejects.toThrow('중단')
    expect(command).toHaveBeenCalledOnce()
    expect(o.onFallback).not.toHaveBeenCalled()
  })
  it('propagates audio denial without retrying captions', async () => {
    const directory = temp(), o = { ...options(directory), skipCaptions: true }
    writeFileSync(join(directory, 'youtube.info.json'), JSON.stringify(info))
    vi.mocked(command).mockRejectedValue(new Error('This video is unavailable'))
    await expect(downloadYouTube(o)).rejects.toThrow('unavailable')
    expect(command).toHaveBeenCalledOnce()
    expect(vi.mocked(command).mock.calls[0][1]).toContain('-f')
  })
  it.each([true, false])('resumes an old 429 job without duplicating it; detected speech=%s', async detectedSpeech => {
    const root = temp(), store = new Store(join(root, 'test.db')); stores.push(store)
    const meeting = store.createMeeting({ title: 'YouTube 영상', startedAt: 1, endedAt: 1, state: 'stopped', eventId: null, app: null, attendees: [] })
    const id = 'e39b3105-3c10-48cd-890a-f0f3920439d3', original = join(root, 'meetings', meeting.id, 'original')
    mkdirSync(join(root, 'imports')); mkdirSync(original, { recursive: true })
    writeFileSync(join(original, 'youtube.info.json'), JSON.stringify(info))
    writeFileSync(join(root, 'imports', id + '.json'), JSON.stringify({ id, meetingId: meeting.id, title: 'YouTube 영상', files: [], url: 'https://www.youtube.com/watch?v=abcdefghijk', caption: true, stage: 'failed', message: "ERROR: Unable to download video subtitles for 'ko': HTTP Error 429", createdAt: 1, updatedAt: 1 }))
    vi.mocked(command).mockImplementation(async (binary, args) => {
      if (binary === 'yt-dlp') { expect(args).not.toContain('--write-subs'); writeFileSync(join(original, 'youtube.webm'), 'audio') }
      if (binary === 'ffmpeg') writeFileSync(args.at(-1)!, 'converted')
      return binary === 'ffprobe' ? '3' : ''
    })
    const transcribe = vi.fn(async () => { if(detectedSpeech)store.addSegments([{ meetingId: meeting.id, track: 'them', startMs: 0, endMs: 3000, text: 'Whisper 전사', speaker: null }]); return true })
    const manager = new ImportManager({ root, store, window: () => undefined, changed: () => {}, available: () => true, recording: () => false, transcribe })
    manager.retry(id)
    await vi.waitFor(() => expect(manager.list()[0].stage).toBe(detectedSpeech?'done':'failed'))
    if(!detectedSpeech){expect(manager.list()[0].message).toContain('인식된 발화가 없습니다');return}
    expect(manager.list()[0].meetingId).toBe(meeting.id)
    expect(transcribe).toHaveBeenCalledOnce()
    expect(store.meeting(meeting.id)?.title).toBe(info.title)
    const source = JSON.parse(readFileSync(join(root, 'meetings', meeting.id, 'import-source.json'), 'utf8'))
    expect(source.transcriptSource).toBe('local-asr'); expect(source.captionFallback).toContain('429')
    const restarted = new ImportManager({ root, store, window: () => undefined, changed: () => {}, available: () => true, recording: () => false, transcribe })
    restarted.retry(id)
    expect(transcribe).toHaveBeenCalledOnce()
  })
})
