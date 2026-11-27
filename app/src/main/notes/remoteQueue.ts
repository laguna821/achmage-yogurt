import type { Job, JobKind } from './queue'
import { AsyncLocalStorage } from 'node:async_hooks'

export const remoteJob = new AsyncLocalStorage<{ meetingId?: string }>()

type Entry = { job: Job; kind: JobKind; meetingId?: string; abort: AbortController; done: Promise<void>; resolve(): void; reject(e: unknown): void }

/** Remote inference has no local-model memory gate. Different records start independently;
 * writes for one record stay ordered. Unscoped maintenance is an exclusive barrier. */
export function createRemoteQueue(o: { modelReady?: () => boolean; onIdle?: () => void; idleMs?: number }) {
  const waiting: Entry[] = [], running = new Set<Entry>(), gone = new Set<string>()
  const exclusive = (e: Entry) => !e.meetingId && e.kind === 'enhance'
  let idle: NodeJS.Timeout | undefined
  const pump = () => {
    if (o.modelReady && !o.modelReady()) return
    for (let i = 0; i < waiting.length;) {
      const e = waiting[i]
      if (exclusive(e)) { if (running.size) break }
      else if ([...running].some(r => exclusive(r) || (e.meetingId ? r.meetingId === e.meetingId : !r.meetingId && r.kind === e.kind))) { i++; continue }
      waiting.splice(i, 1); running.add(e)
      void (async () => {
        try { await remoteJob.run({ meetingId: e.meetingId }, () => e.job(e.abort.signal)); e.resolve() }
        catch (err) { if (e.abort.signal.aborted) e.resolve(); else e.reject(err) }
        finally { running.delete(e); pump() }
      })()
      if (exclusive(e)) break
    }
    if (!running.size && !waiting.length && o.onIdle && !idle) idle = setTimeout(() => { idle = undefined; if (!running.size && !waiting.length) o.onIdle?.() }, o.idleMs ?? 600_000)
  }
  const stop = (matches: (e: Entry) => boolean) => {
    for (const e of waiting.filter(matches)) { waiting.splice(waiting.indexOf(e), 1); e.resolve() }
    const active = [...running].filter(matches)
    for (const e of active) e.abort.abort()
    pump()
    return Promise.all(active.map(e => e.done.catch(() => {}))).then(() => {})
  }
  return {
    enqueue(job: Job, kind: JobKind, meetingId?: string): Promise<void> {
      if (meetingId && gone.has(meetingId)) return Promise.resolve()
      if (idle) { clearTimeout(idle); idle = undefined }
      if (kind === 'index') { const e = waiting.find(e => e.kind === kind); if (e) return e.done }
      if (kind === 'readahead') for (const e of waiting.filter(e => e.kind === kind && e.meetingId === meetingId)) { waiting.splice(waiting.indexOf(e), 1); e.resolve() }
      let resolve!: () => void, reject!: (e: unknown) => void
      const done = new Promise<void>((yes, no) => { resolve = yes; reject = no })
      waiting.push({ job, kind, meetingId, abort: new AbortController(), done, resolve, reject }); pump()
      return done
    },
    cancelAnalysis: (id: string) => stop(e => e.meetingId === id && ['enhance', 'readahead', 'folder'].includes(e.kind)),
    recordingChanged: () => { pump() },
    cancel(id: string) { gone.add(id); void stop(e => e.meetingId === id) },
    restore(id: string) { gone.delete(id); pump() },
    modelArrived: pump,
    busy: () => !!(running.size || waiting.length),
  }
}
