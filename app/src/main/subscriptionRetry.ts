function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal?.reason ?? new Error('Stopped')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

export class SubscriptionRateLimit extends Error {}
export function transientSubscriptionLimit(detail: string) {
  // An exhausted subscription needs the user, not a loop of new sessions.
  return !/usage.limit|quota|limit.*reached|out of.*(credit|usage)|reset.*(hour|day)/i.test(detail) && /429|rate[ _-]?limit|too many requests/i.test(detail)
}
export async function retrySubscription<T>(run: (token: () => void) => Promise<T>, signal?: AbortSignal, waiting: (ms?: number) => void = () => {}) {
  let streamed = false
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted()
    try { return await run(() => { streamed = true }) }
    catch (e) {
      if (!(e instanceof SubscriptionRateLimit) || streamed || signal?.aborted || attempt >= 3) throw e
      const ms = [5000, 15000, 30000][attempt]
      waiting(ms)
      try { await pause(ms, signal) } finally { waiting() }
    }
  }
}
