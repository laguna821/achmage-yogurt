import { spawn } from 'node:child_process'
import { subscriptionCli, subscriptionEnv } from './subscriptionEngine'

type Metadata = { codexModels?: { id: string; efforts: string[] }[]; codexPlan?: string }
let cache: { at: number; value: Promise<Metadata> } | undefined
/** Read official account/model metadata only. Never create a thread or invoke a model. */
export function subscriptionMetadata(): Promise<Metadata> {
  if (cache && Date.now() - cache.at < 300_000) return cache.value
  const value = new Promise<Metadata>(resolve => {
    const child = spawn(subscriptionCli('codex'), ['app-server', '--listen', 'stdio://', '-c', 'features.apps=false', '-c', 'features.plugins=false', '-c', 'features.memories=false'], { env: subscriptionEnv(), stdio: ['pipe','pipe','pipe'] })
    let pending = '', done = false, count = 0
    const result: Metadata = {}
    const finish = () => {
      if (done) return; done = true; clearTimeout(timer); child.stdin.end(); resolve(result)
      const stop = setTimeout(() => { if (child.exitCode === null) child.kill('SIGTERM') }, 1500); stop.unref()
    }
    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n')
    const timer = setTimeout(finish, 12_000); timer.unref()
    child.stdout.setEncoding('utf8'); child.stderr.resume(); child.stdin.on('error', () => {})
    child.on('error', finish); child.on('exit', finish)
    child.stdout.on('data', (s: string) => {
      if (done) return
      pending += s; if (pending.length > 2_000_000) return finish()
      let n: number
      while ((n = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0,n); pending = pending.slice(n+1)
        try {
          const e = JSON.parse(line)
          if (e.id === 1) {
            if (e.error) return finish()
            send({method:'initialized',params:{}})
            send({id:2,method:'model/list',params:{includeHidden:true}})
            send({id:3,method:'account/read',params:{refreshToken:false}})
          } else if (e.id === 2 || e.id === 3) {
            if (e.id === 2 && Array.isArray(e.result?.data)) result.codexModels = e.result.data.filter((m: any) => typeof m.model === 'string').map((m: any) => ({id:m.model,efforts:(m.supportedReasoningEfforts ?? []).map((v: any) => v.reasoningEffort).filter((s: unknown) => typeof s === 'string')}))
            if (e.id === 3 && e.result?.account?.type === 'chatgpt') result.codexPlan = String(e.result.account.planType || 'unknown')
            if (++count === 2) finish()
          }
        } catch { /* startup notices are not account data */ }
      }
    })
    send({id:1,method:'initialize',params:{clientInfo:{name:'yogurt',version:'0.3.38'},capabilities:{experimentalApi:true}}})
  })
  cache = {at:Date.now(),value}; return value
}
