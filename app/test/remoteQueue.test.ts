import { describe, expect, it, vi } from 'vitest'
import { createQueue } from '../src/main/notes/queue'
import { remoteJob } from '../src/main/notes/remoteQueue'
import { retrySubscription, SubscriptionRateLimit, transientSubscriptionLimit } from '../src/main/subscriptionRetry'
import { createActivity } from '../src/main/activity'

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
const tick = () => new Promise(r => setTimeout(r, 0))
describe('subscription jobs', () => {
  for (const remote of [true, false]) it(`restoring a trashed record allows new work without rerunning cancelled work (remote=${remote})`, async () => {
    const q = createQueue({ remote, recording: () => false, smallMac: false }), hold = deferred()
    const old = vi.fn(async () => { await hold.promise }), fresh = vi.fn(async () => {})
    const first = q.enqueue(old, 'enhance', 'a'); q.cancel('a'); q.restore('a')
    const next = q.enqueue(fresh, 'enhance', 'a'); hold.resolve(); await Promise.all([first, next])
    expect(old).toHaveBeenCalledOnce(); expect(fresh).toHaveBeenCalledOnce()
  })
  it('starts six independent records during recording/backlog, without a two-job gate', async () => {
    const q = createQueue({ remote: true, recording: () => true, smallMac: true, backlogMs: () => 90000 })
    const hold = deferred(), started: string[] = []
    const jobs = Array.from({ length: 6 }, (_, i) => q.enqueue(async () => { started.push(remoteJob.getStore()!.meetingId!); await hold.promise }, 'enhance', `m${i}`))
    expect(started).toEqual(['m0','m1','m2','m3','m4','m5'])
    hold.resolve(); await Promise.all(jobs); expect(q.busy()).toBe(false)
  })
  it('serializes one record; cancelling its work does not abort another and allows resume', async () => {
    const q = createQueue({ remote: true, recording: () => false, smallMac: true }), a = deferred(), b = deferred()
    let aSignal!: AbortSignal, bSignal!: AbortSignal
    const first = q.enqueue(async s => { aSignal = s; await a.promise }, 'enhance', 'a')
    const old = vi.fn(async () => {}), queued = q.enqueue(old, 'enhance', 'a')
    const other = q.enqueue(async s => { bSignal = s; await b.promise }, 'enhance', 'b')
    let settled = false
    const stop = q.cancelAnalysis('a').then(() => { settled = true })
    await tick(); expect(settled).toBe(false); expect(aSignal.aborted).toBe(true); expect(bSignal.aborted).toBe(false); expect(old).not.toHaveBeenCalled()
    a.resolve(); await Promise.all([stop, first, queued]); expect(q.busy()).toBe(true)
    const fresh = vi.fn(async () => {}); await q.enqueue(fresh, 'enhance', 'a'); expect(fresh).toHaveBeenCalledOnce()
    b.resolve(); await other
  })
  it('same-record calls wait, unscoped maintenance waits for all and model readiness gates starts', async () => {
    let ready = false
    const q = createQueue({ remote: true, recording: () => false, smallMac: false, modelReady: () => ready })
    const hold = deferred(), log: string[] = []
    const first = q.enqueue(async () => { log.push('a'); await hold.promise }, 'enhance', 'a')
    const second = q.enqueue(async () => { log.push('a2') }, 'enhance', 'a')
    const maintenance = q.enqueue(async () => { log.push('maintenance') }, 'enhance')
    const last = q.enqueue(async () => { log.push('b') }, 'enhance', 'b')
    expect(log).toEqual([]); ready = true; q.modelArrived(); expect(log).toEqual(['a'])
    hold.resolve(); await Promise.all([first,second,maintenance,last]); expect(log).toEqual(['a','a2','maintenance','b'])
  })
  it('does not block independent records behind background indexing', async () => {
    const q = createQueue({ remote: true, recording: () => false, smallMac: false }), hold = deferred()
    const index = q.enqueue(async () => hold.promise, 'index')
    const work = vi.fn(async () => {}); await q.enqueue(work, 'enhance', 'a'); expect(work).toHaveBeenCalledOnce()
    hold.resolve(); await index
  })
  it('deletion drops waiting and future work and preserves other records', async () => {
    const q = createQueue({ remote: true, recording: () => false, smallMac: false }), hold = deferred()
    let signal!: AbortSignal
    const first = q.enqueue(async s => { signal = s; await hold.promise }, 'enhance', 'a')
    const dropped = vi.fn(async () => {}), queued = q.enqueue(dropped, 'enhance', 'a')
    q.cancel('a'); expect(signal.aborted).toBe(true); await q.enqueue(dropped, 'enhance', 'a'); expect(dropped).not.toHaveBeenCalled()
    hold.resolve(); await Promise.all([first,queued])
  })
})
describe('provider throttling', () => {
  it('retries only transient limits, and never retries after tokens are emitted', async () => {
    expect(transientSubscriptionLimit('HTTP 429 Too Many Requests')).toBe(true)
    expect(transientSubscriptionLimit('usage limit reached HTTP 429')).toBe(false)
    const run = vi.fn(async (token: () => void) => { token(); throw new SubscriptionRateLimit('rate') })
    await expect(retrySubscription(run)).rejects.toThrow('rate'); expect(run).toHaveBeenCalledOnce()
  })
  it('has bounded backoff and clears the row waiting state after cancellation', async () => {
    vi.useFakeTimers()
    try {
      const waiting = vi.fn(), run = vi.fn().mockRejectedValueOnce(new SubscriptionRateLimit('rate')).mockResolvedValue('ok')
      const done = retrySubscription(run, undefined, waiting)
      await vi.advanceTimersByTimeAsync(5000); await expect(done).resolves.toBe('ok'); expect(waiting.mock.calls).toEqual([[5000],[]])
      const c = new AbortController(), stop = retrySubscription(async () => { throw new SubscriptionRateLimit('rate') }, c.signal, waiting).catch(e => e)
      await vi.advanceTimersByTimeAsync(0); c.abort(); expect(await stop).toBeInstanceOf(Error); expect(waiting).toHaveBeenLastCalledWith()
    } finally { vi.useRealTimers() }
  })
})
it('activity snapshots exclude content, preserve another channel and cannot resurrect trashed rows', () => {
  let valid = true
  const changed = vi.fn(), a = createActivity(() => valid, changed)
  a.set('m','notes','active','정리 중'); a.set('m','organizer','active','자료 대조 중'); a.set('m','retry','waiting','요청 제한')
  expect(a.list()[0].state).toBe('waiting'); a.set('m','retry'); expect(a.list()[0].label).toBe('자료 대조 중')
  a.set('m','organizer'); a.set('m','notes'); expect(a.list()).toEqual([])
  valid = false; a.set('m','notes','active','late'); expect(a.list()).toEqual([])
})
