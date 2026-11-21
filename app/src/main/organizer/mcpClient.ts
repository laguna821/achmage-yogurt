import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { subscriptionEnv } from '../subscriptionEngine'

export type McpConfig = { command: string; args?: string[]; env?: Record<string, string> }
export type McpTool = { name: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] } }
export type McpResult = { content?: { type: string; text?: string }[]; isError?: boolean }
export const mcpText = (r: McpResult) => (r.content ?? []).filter(c => c.type === 'text').map(c => c.text || '').join('\n')

/** Existing official/client configs own their credentials. They are neither displayed nor copied. */
export function localMcpConfigs(): Record<string, McpConfig> {
  try {
    const x = JSON.parse(readFileSync(join(os.homedir(), '.claude.json'), 'utf8'))
    return Object.fromEntries(Object.entries(x.mcpServers ?? {}).filter(([, v]: [string, any]) => typeof v.command === 'string').map(([k, v]) => [k, v as McpConfig]))
  } catch { return {} }
}

/** Read-only client: the host, never the model, chooses from an explicit tool allowlist. */
export class ReadOnlyMcp {
  private child: ChildProcessWithoutNullStreams
  private pending = new Map<number, { resolve: (x: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  private seq = 0
  private ready: Promise<void>
  private buffer = ''
  private closed = false
  private abort: () => void
  constructor(config: McpConfig, private allowed: Set<string>, signal?: AbortSignal) {
    this.child = spawn(config.command, config.args ?? [], { env: { ...subscriptionEnv(), ...config.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const fail = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('읽기 연결이 종료되었습니다.')) }; this.pending.clear() }
    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (s: string) => {
      this.buffer += s
      if (Buffer.byteLength(this.buffer) > 4_000_000) { this.close(); return }
      let i: number
      while ((i = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, i); this.buffer = this.buffer.slice(i + 1)
        try {
          const r = JSON.parse(line), p = this.pending.get(r.id)
          if (!p) continue
          this.pending.delete(r.id); clearTimeout(p.timer)
          r.error ? p.reject(new Error(String(r.error.message || '읽기 연결 오류'))) : p.resolve(r.result)
        } catch { /* MCP startup notices are not source data. */ }
      }
    })
    this.child.stderr.on('data', () => {})
    this.child.stdin.on('error', () => {})
    this.child.on('error', fail); this.child.on('close', fail)
    this.abort = () => this.close()
    signal?.addEventListener('abort', this.abort, { once: true })
    this.child.once('close', () => signal?.removeEventListener('abort', this.abort))
    this.ready = this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'Yogurt transcript evidence', version: '1' } }).then(() => {
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
    })
    void this.ready.catch(() => {})
    if (signal?.aborted) this.close()
  }
  private request(method: string, params: object): Promise<any> {
    if (this.closed) return Promise.reject(new Error('읽기 연결이 닫혔습니다.'))
    return new Promise((resolve, reject) => {
      const id = ++this.seq
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('자료 읽기 연결이 응답하지 않습니다.')) }, 45_000)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  async list(): Promise<McpTool[]> { await this.ready; return (await this.request('tools/list', {})).tools ?? [] }
  async call(name: string, args: object): Promise<McpResult> {
    if (!this.allowed.has(name)) throw new Error('허용되지 않은 자료 도구입니다.')
    await this.ready
    const result = await this.request('tools/call', { name, arguments: args }) as McpResult
    if (result.isError) throw new Error('연결된 자료 제공자가 읽기 요청을 처리하지 못했습니다.')
    return result
  }
  close() {
    if (this.closed) return
    this.closed = true; this.child.stdin.end()
    // Only this dedicated child; normal EOF first, then normal SIGTERM for an unresponsive server.
    const timer = setTimeout(() => { if (this.child.exitCode === null) this.child.kill('SIGTERM') }, 1500)
    timer.unref(); this.child.once('close', () => clearTimeout(timer))
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('자료 탐색이 중단되었습니다.')) }; this.pending.clear()
  }
}
