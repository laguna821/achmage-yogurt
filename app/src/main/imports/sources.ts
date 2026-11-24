import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { youtubeUrl, type ImportJob } from '../../shared/imports'

const read = (path: string): any => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined } }
const names = (path: string) => { try { return readdirSync(path) } catch { return [] } }
const validUrl = (url: unknown) => { try { return typeof url === 'string' ? youtubeUrl(url) : undefined } catch { return undefined } }
const isId = (id: string) => /^[a-f0-9-]{36}$/.test(id)

/** Source identity survives failed imports and is independent of transcription readiness. */
export class VideoSources {
  private known = new Set<string>()
  constructor(private root: string, private liveJobs?: () => ImportJob[] | undefined) {
    for (const id of names(join(root, 'meetings')).filter(isId)) {
      const dir = join(root, 'meetings', id)
      if (validUrl(read(join(dir, 'import-source.json'))?.url) || validUrl(read(join(dir, 'video/state.json'))?.metadata?.url)) this.known.add(id)
    }
  }
  private jobs() {
    return this.liveJobs?.() ?? names(join(this.root, 'imports')).filter(n => n.endsWith('.json')).map(n => read(join(this.root, 'imports', n))).filter((j): j is ImportJob => !!j && typeof j.id === 'string' && isId(j.id) && typeof j.meetingId === 'string' && isId(j.meetingId))
  }
  remember(id: string, url: string) { if (isId(id) && validUrl(url)) this.known.add(id) }
  ids() {
    const ids = new Set(this.known)
    for (const j of this.jobs()) if (j.meetingId && validUrl(j.url)) ids.add(j.meetingId)
    return [...ids]
  }
  get(id: string) {
    if (!isId(id)) return
    const dir = join(this.root, 'meetings', id)
    const source = read(join(dir, 'import-source.json')) || {}, info = read(join(dir, 'original/youtube.info.json')) || {}
    const job = this.jobs().filter(j => j.meetingId === id && validUrl(j.url)).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const url = validUrl(source.url) || validUrl(job?.url) || validUrl(info.webpage_url) || validUrl(info.original_url)
    if (!url) return
    this.known.add(id)
    return { source: { ...source, ...(job || {}), url }, info, job, url }
  }
}
