import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { MEDIA_EXTS, parseTranscript } from '../../shared/imports'
import { command, mediaNode, mediaTool } from './tools'

export type YouTubeInfo = { title?: string; language?: string; subtitles?: Record<string, unknown>; automatic_captions?: Record<string, unknown> }
export type CaptionTrack = { language: string; automatic: boolean }

/** Select one real track, rather than requesting every translated ko.* / en.* track. */
export function chooseCaption(info: YouTubeInfo): CaptionTrack | undefined {
  const tracks = [false, true].flatMap(automatic => Object.entries(automatic ? info.automatic_captions || {} : info.subtitles || {})
    .filter(([language, formats]) => language !== 'live_chat' && /^[A-Za-z0-9_-]{1,60}$/.test(language) && Array.isArray(formats) && formats.length > 0)
    .map(([language]) => ({ language, automatic })))
  const rank = (t: CaptionTrack) => {
    const language = t.language.toLowerCase()
    const group = language === 'ko' || language.startsWith('ko-') ? 0 : language === 'en' || language.startsWith('en-') ? 1 : language === info.language ? 2 : 3
    return group * 10 + Number(t.automatic)
  }
  return tracks.sort((a, b) => rank(a) - rank(b) || a.language.localeCompare(b.language))[0]
}

export function captionProblem(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  return /429|too many requests/i.test(detail) ? 'YouTube가 자막 요청을 일시 제한했습니다(429). 자막 재요청을 멈추고 음성 전사로 전환합니다.'
    : '자막을 읽지 못해 음성을 받아 로컬 모델로 전사합니다.'
}

export function youtubeImportError(detail: string): string {
  if (detail.startsWith('음성은 저장됐지만')) return detail
  if (/failed to resolve|name resolution|ENOTFOUND|EAI_AGAIN/i.test(detail)) return 'YouTube 서버 주소를 찾지 못했습니다. 인터넷·DNS 연결을 확인한 뒤 다시 시작하세요. 확보한 파일은 보존했습니다.'
  if (/429|too many requests/i.test(detail)) return 'YouTube가 요청을 일시 제한했습니다(429). 잠시 후 다시 시작하거나 음성 파일을 가져오세요.'
  if (/sign in|login|private video|members.only|age.restricted|unavailable|not available|removed/i.test(detail)) return 'YouTube 영상에 접근하지 못했습니다. 공개 상태를 확인하거나 보유한 음성·영상 파일을 가져오세요.'
  return 'YouTube 가져오기를 완료하지 못했습니다. 작업의 기술 정보를 확인하고 다시 시작하거나 음성 파일을 가져오세요.'
}

type Options = {
  directory: string; url: string; captions: boolean; skipCaptions?: boolean; signal: AbortSignal
  onInfo: (info: YouTubeInfo) => void
  onFallback: (message: string, detail: string) => void
  onProgress: (message: string) => void
}
export async function downloadYouTube(o: Options): Promise<{ audio?: string; transcript?: string; track?: CaptionTrack }> {
  const base = join(o.directory, 'youtube'), infoFile = base + '.info.json'
  const common = ['--ignore-config', '--no-playlist', '--no-warnings', '--socket-timeout', '30', '--retries', '0', '--fragment-retries', '0',
    '--ffmpeg-location', mediaTool('ffmpeg'), '--js-runtimes', `node:${mediaNode()}`, '-o', base + '.%(ext)s']
  const run = (args: string[]) => command(mediaTool('yt-dlp'), [...common, ...args, o.url], o.signal, undefined, { ELECTRON_RUN_AS_NODE: '1' })
  const check = () => { if (o.signal.aborted) throw new Error('작업을 중단했습니다.') }
  check()
  // Metadata survives a caption endpoint failure, including the video's real title.
  if (!existsSync(infoFile)) {
    o.onProgress('YouTube 영상 정보를 확인하고 있습니다.')
    await run(['--skip-download', '--write-info-json'])
  }
  const info: YouTubeInfo = JSON.parse(readFileSync(infoFile, 'utf8'))
  o.onInfo(info)
  const track = chooseCaption(info)
  if (o.captions && !o.skipCaptions) {
    try {
      if (!track) throw new Error('사용 가능한 자막 트랙이 없습니다.')
      const transcript = `${base}.${track.language}.vtt`
      const valid = () => {
        if (!existsSync(transcript) || !statSync(transcript).size) return false
        try { return parseTranscript(readFileSync(transcript, 'utf8'), 'vtt').turns.length > 0 } catch { return false }
      }
      if (!valid()) {
        o.onProgress(`${track.language} ${track.automatic ? '자동' : '제공'} 자막 한 개를 가져오고 있습니다.`)
        await run(['--skip-download', '--no-write-info-json', '--force-overwrites', track.automatic ? '--write-auto-subs' : '--write-subs',
          track.automatic ? '--no-write-subs' : '--no-write-auto-subs', '--sub-langs', '^' + track.language.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', '--sub-format', 'vtt'])
      }
      check()
      if (!valid()) throw new Error('자막 파일이 비었거나 유효한 시간 구간이 없습니다.')
      return { transcript, track }
    } catch (error) {
      check() // A user's cancellation must never start another download.
      o.onFallback(captionProblem(error), error instanceof Error ? error.message : String(error))
    }
  }
  check()
  const findAudio = () => readdirSync(o.directory).filter(n => n.startsWith('youtube.') && MEDIA_EXTS.includes(extname(n).slice(1)))
    .map(n => join(o.directory, n)).find(p => statSync(p).size > 0)
  let audio = findAudio()
  if (!audio) {
    o.onProgress(o.captions ? '자막 대신 오디오를 가져오고 있습니다. 이후 로컬 모델로 전사합니다.' : 'YouTube 오디오를 가져오고 있습니다.')
    await run(['--no-write-subs', '--no-write-auto-subs', '--no-write-info-json', '-f', 'bestaudio/best'])
    audio = findAudio()
  }
  check()
  if (!audio) throw new Error('다운로드된 오디오가 없습니다. YouTube 영상 접근 상태를 확인하거나 음성 파일을 가져오세요.')
  return { audio }
}
