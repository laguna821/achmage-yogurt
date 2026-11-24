import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { command, mediaNode, mediaTool } from '../imports/tools'
import type { VideoMetadata } from '../../shared/video'
import { evenly, hash } from './document'
export type Candidate = { atMs: number; path: string }
const nonempty = (p: string) => existsSync(p) && statSync(p).size > 0
export async function ensureVideo(directory: string, meta: VideoMetadata, signal: AbortSignal): Promise<string> {
  mkdirSync(directory, { recursive: true })
  const existing = () => readdirSync(directory).find(n => /^source\.(mp4|mkv|webm)$/.test(n) && nonempty(join(directory, n)))
  let found = existing()
  if (!found) {
    await command(mediaTool('yt-dlp'), ['--ignore-config', '--no-playlist', '--no-warnings', '--no-write-subs', '--no-write-auto-subs', '--no-write-info-json', '--retries', '0', '--fragment-retries', '0', '--socket-timeout', '30', '--max-filesize', '2G', '--ffmpeg-location', mediaTool('ffmpeg'), '--js-runtimes', `node:${mediaNode()}`, '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best', '--merge-output-format', 'mkv', '-o', join(directory, 'source.%(ext)s'), meta.url], signal, undefined, { ELECTRON_RUN_AS_NODE: '1' })
    found = existing()
  }
  if (!found) throw new Error('화면 분석용 영상을 확보하지 못했습니다.')
  const path = join(directory, found)
  const probe = JSON.parse(await command(mediaTool('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path], signal))
  if (!probe.streams?.[0]?.width) throw new Error('확보한 파일에 영상 화면이 없습니다.')
  return path
}
/** Sample once per second, select screen changes and periodic coverage, retain the original timeline. */
export async function candidates(video: string, directory: string, meta: VideoMetadata, signal: AbortSignal): Promise<{ frames: Candidate[]; sampled: number; total: number }> {
  const key = hash(JSON.stringify([statSync(video).size, meta.startMs, meta.endMs, 'scene-v2-trim']))
  const dir = join(directory, key), index = join(dir, 'index.json')
  if (existsSync(index)) { const value = JSON.parse(readFileSync(index, 'utf8')); if (value.frames.every((c: Candidate) => nonempty(c.path))) return value }
  mkdirSync(dir, { recursive: true })
  const duration = (meta.endMs - meta.startMs) / 1000
  if (duration > 14400) throw new Error('화면 분석은 한 번에 4시간까지 지원합니다. 구간을 나눠 주세요.')
  const times: number[] = []; let buffer = ''
  await command(mediaTool('ffmpeg'), ['-nostdin', '-y', '-hide_banner', '-loglevel', 'info', '-protocol_whitelist', 'file,pipe', '-ss', String(meta.startMs / 1000), '-i', video, '-t', String(duration), '-vf', `fps=1,trim=duration=${duration},scale='min(640,iw)':-2,select='gt(scene,0.08)+isnan(prev_selected_t)+gte(t-prev_selected_t,15)',showinfo`, '-fps_mode', 'vfr', '-q:v', '5', join(dir, 'candidate-%06d.jpg')], signal, text => {
    buffer += text; const lines = buffer.split(/[\r\n]/); buffer = lines.pop() || ''
    for (const line of lines) { const match = line.match(/\bn:\s*\d+.*?pts_time:([\d.e+-]+)/); if (match) times.push(meta.startMs + Math.round(Number(match[1]) * 1000)) }
  })
  const files = readdirSync(dir).filter(n => /^candidate-\d+\.jpg$/.test(n)).sort()
  if (!files.length || times.length !== files.length) throw new Error('화면 파일과 실제 시각을 대응하지 못했습니다.')
  const all = files.map((name, n) => ({ path: join(dir, name), atMs: times[n] })).filter(c => c.atMs < meta.endMs)
  const value = { frames: evenly(all, 240), sampled: Math.ceil(duration), total: all.length }
  writeFileSync(index + '.tmp', JSON.stringify(value)); renameSync(index + '.tmp', index)
  return value
}
export async function contactSheet(frames: Candidate[], directory: string, signal: AbortSignal): Promise<string> {
  const dir = join(directory, hash(frames.map(c => c.path).join('|')).slice(0, 20)); mkdirSync(dir, { recursive: true })
  const output = join(dir, 'sheet.jpg')
  if (nonempty(output)) return output
  for (const [i, c] of frames.entries()) copyFileSync(c.path, join(dir, `${String(i).padStart(3, '0')}.jpg`))
  await command(mediaTool('ffmpeg'), ['-nostdin', '-y', '-v', 'error', '-framerate', '1', '-i', join(dir, '%03d.jpg'), '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=4x4', '-frames:v', '1', output], signal)
  return output
}
export async function extractFrame(video: string, atMs: number, directory: string, signal: AbortSignal): Promise<{ file: string; path: string; sha256: string }> {
  mkdirSync(directory, { recursive: true })
  const file = `frame-${hash(`${statSync(video).size}:${atMs}`).slice(0, 16)}.jpg`, path = join(directory, file)
  if (!nonempty(path)) {
    const temp = path.replace(/\.jpg$/, '.temp.jpg')
    try { await command(mediaTool('ffmpeg'), ['-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(atMs / 1000), '-i', video, '-frames:v', '1', '-vf', "scale='min(1600,iw)':-2", '-q:v', '2', temp], signal); renameSync(temp, path) }
    finally { rmSync(temp, { force: true }) }
  }
  return { file, path, sha256: hash(readFileSync(path)) }
}
