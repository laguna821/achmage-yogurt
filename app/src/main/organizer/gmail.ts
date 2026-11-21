import { createServer, type Server } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { Evidence } from '../../shared/organizer'

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export type GmailStatus = { configured: boolean; connected: boolean; connecting: boolean; account?: string; message: string }
type Token = { access_token: string; refresh_token?: string; expiresAt: number; account?: string }
type Client = { client_id: string; client_secret?: string }
type Codec = { encode(s: string): Buffer; decode(b: Buffer): string }
const plain: Codec = { encode: s => Buffer.from(s), decode: b => b.toString() }
const b64 = (s: string) => Buffer.from(s, 'base64url').toString('utf8')
export function messageText(payload: any): string {
  if (payload.mimeType === 'text/plain' && payload.body?.data) return b64(payload.body.data)
  const parts = (payload.parts ?? []).map(messageText).filter(Boolean)
  if (parts.length) return parts.join('\n')
  return payload.mimeType === 'text/html' && payload.body?.data ? b64(payload.body.data).replace(/<[^>]*>/g, ' ') : ''
}
/** Native desktop OAuth with PKCE; only read endpoints and gmail.readonly scope exist in this client. */
export class GmailConnector {
  private server?: Server
  private connecting = false
  private message = 'Gmail을 연결하면 관련 질문과 날짜로 좁혀 읽습니다.'
  private refresh?: Promise<Token>
  constructor(private dir: string, private codec: Codec = plain, private fetcher: typeof fetch = fetch) {}
  private path(name: string) { return join(this.dir, name) }
  private client(): Client | undefined { try { return JSON.parse(readFileSync(this.path('client.json'), 'utf8')) } catch { return } }
  private token(): Token | undefined { try { return JSON.parse(this.codec.decode(readFileSync(this.path('token.local')))) } catch { return } }
  private save(t: Token) { mkdirSync(this.dir, { recursive: true, mode: 0o700 }); writeFileSync(this.path('token.local'), this.codec.encode(JSON.stringify(t)), { mode: 0o600 }) }
  status(): GmailStatus { const t = this.token(); return { configured: !!this.client(), connected: !!t?.refresh_token || !!t && t.expiresAt > Date.now(), connecting: this.connecting, account: t?.account, message: this.message } }
  configure(json: unknown) {
    const root = json as any, c = root?.installed
    if (!c || typeof c.client_id !== 'string' || !c.client_id.endsWith('.apps.googleusercontent.com')) throw new Error('Google Desktop 앱 OAuth 클라이언트 JSON을 선택하세요.')
    if (this.client()?.client_id !== c.client_id) rmSync(this.path('token.local'), {force: true})
    mkdirSync(this.dir, { recursive: true, mode: 0o700 }); writeFileSync(this.path('client.json'), JSON.stringify({ client_id: c.client_id, client_secret: typeof c.client_secret === 'string' ? c.client_secret : undefined }), { mode: 0o600 })
    this.message = '연결 준비가 됐습니다. Google 로그인을 진행하세요.'
  }
  async connect(open: (url: string) => Promise<void>): Promise<GmailStatus> {
    const client = this.client(); if (!client) throw new Error('설정에서 Google Desktop OAuth 클라이언트 JSON을 먼저 등록하세요.')
    if (this.connecting) return this.status()
    const verifier = randomBytes(32).toString('base64url'), state = randomBytes(24).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    this.connecting = true; this.message = '브라우저에서 Google 로그인과 읽기 권한을 확인하세요.'
    let redirect = '', timer: NodeJS.Timeout | undefined
    const stop = () => { clearTimeout(timer); this.server?.close(); this.server = undefined; this.connecting = false }
    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', redirect)
      if (url.pathname !== '/callback') { res.writeHead(404).end(); return }
      if (url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid OAuth state'); return }
      const code = url.searchParams.get('code')
      if (!code || url.searchParams.has('error')) { this.message = 'Google 연결이 취소되었습니다.'; res.end('연결이 취소되었습니다. Yogurt로 돌아가세요.'); stop(); return }
      try {
        const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}), code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }) })
        const t = await response.json() as any
        if (!response.ok || !t.access_token) throw new Error('Google이 연결을 승인하지 않았습니다.')
        if (t.scope && !String(t.scope).split(' ').includes(GMAIL_SCOPE)) throw new Error('Gmail 읽기 권한이 없습니다.')
        const token: Token = { access_token: t.access_token, refresh_token: t.refresh_token, expiresAt: Date.now() + Number(t.expires_in || 3600) * 1000 }
        this.save(token)
        const profile = await this.request('profile') as any; token.account = profile.emailAddress; this.save(token)
        this.message = 'Gmail 읽기 연결이 완료됐습니다.'; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<h2>Gmail 연결 완료</h2><p>이 창을 닫고 Yogurt로 돌아가세요.</p>')
      } catch { this.message = 'Gmail 연결을 완료하지 못했습니다. OAuth 설정과 권한을 확인하세요.'; res.writeHead(400).end('Gmail connection failed. Return to Yogurt.'); }
      finally { stop() }
    })
    this.server = server
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('로그인 창을 열지 못했습니다.')
      redirect = `http://127.0.0.1:${address.port}/callback`
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth'); auth.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: 'code', scope: GMAIL_SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString()
      timer = setTimeout(() => { this.message = '로그인 시간이 지나 연결을 취소했습니다.'; stop() }, 180_000); timer.unref()
      await open(auth.toString()); return this.status()
    } catch (e) { stop(); throw e }
  }
  private async currentToken(): Promise<Token> {
    const t = this.token(), c = this.client(); if (!t || !c) throw new Error('Gmail 로그인이 필요합니다.')
    if (t.expiresAt > Date.now() + 60_000) return t
    if (!t.refresh_token) throw new Error('Gmail에 다시 로그인하세요.')
    return this.refresh ??= (async () => {
      const response = await this.fetcher('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, ...(c.client_secret ? { client_secret: c.client_secret } : {}), refresh_token: t.refresh_token!, grant_type: 'refresh_token' }) })
      const x = await response.json() as any; if (!response.ok || !x.access_token) throw new Error('Gmail 로그인을 갱신하지 못했습니다.')
      const token = { ...t, access_token: x.access_token, expiresAt: Date.now() + Number(x.expires_in || 3600) * 1000 }; this.save(token); return token
    })().finally(() => { this.refresh = undefined })
  }
  private async request(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!/^(profile|messages(?:\?|\/)[A-Za-z0-9_?=&%+.,~!'-]+)$/.test(path)) throw new Error('허용되지 않은 Gmail 읽기 경로입니다.')
    const t = await this.currentToken(), response = await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${t.access_token}` }, signal })
    if (!response.ok) throw new Error(`Gmail 읽기 실패 (${response.status})`)
    return response.json()
  }
  async search(query: string, signal?: AbortSignal): Promise<Evidence[]> {
    if (!query.trim() || query.length > 400) throw new Error('관련 메일 검색어를 입력하세요.')
    const result = await this.request(`messages?q=${encodeURIComponent(query)}&maxResults=3`, signal) as any
    const output: Evidence[] = []
    for (const item of result.messages ?? []) {
      if (!/^[a-zA-Z0-9]+$/.test(item.id)) continue
      const msg = await this.request(`messages/${item.id}?format=full`, signal) as any
      const headers = msg.payload?.headers ?? [], header = (name: string) => headers.find((h: any) => String(h.name).toLowerCase() === name)?.value || ''
      const text = `제목: ${header('subject')}\n발신: ${header('from')}\n일시: ${header('date')}\n${messageText(msg.payload ?? {}).slice(0, 10_000)}`
      output.push({ id: `M${output.length + 1}`, provider: 'mail', title: header('subject') || 'Gmail 메시지', locator: `https://mail.google.com/mail/u/0/#all/${item.id}`, text, revision: createHash('sha256').update(text).digest('hex'), issueIds: [] })
    }
    return output
  }
  async disconnect() { this.server?.close(); this.server = undefined; this.connecting = false; rmSync(this.path('token.local'), { force: true }); this.message = '이 컴퓨터의 Gmail 연결을 해제했습니다.'; return this.status() }
}
