import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { PlaudStatus } from '../../shared/plaud'
import { mcpData } from './data'

const BASE = 'https://mcp.plaud.ai'
type Credentials = { clientId: string; clientSecret?: string; accessToken: string; refreshToken?: string; expiresAt: number }
type Codec = { encode(text: string): Buffer; decode(bytes: Buffer): string }
export class PlaudConnector {
  private server?: Server
  private timer?: NodeJS.Timeout
  private connecting = false
  private generation = 0
  private refresh?: Promise<Credentials>
  private message = 'Plaud 계정을 연결하면 녹음 원음을 가져올 수 있습니다.'
  constructor(private directory: string, private codec: Codec, private open: (url: string) => Promise<void>, private fetcher: typeof fetch = fetch) {}
  private credentials(): Credentials | undefined { try { return JSON.parse(this.codec.decode(readFileSync(join(this.directory,'auth.local')))) } catch { return } }
  private save(value: Credentials) {
    mkdirSync(this.directory,{recursive:true,mode:0o700})
    const path=join(this.directory,'auth.local');writeFileSync(path+'.tmp',this.codec.encode(JSON.stringify(value)),{mode:0o600});renameSync(path+'.tmp',path)
  }
  status(): PlaudStatus { const c=this.credentials();return {connected:!!c && (!!c.refreshToken || c.expiresAt>Date.now()),connecting:this.connecting,message:this.message} }
  close() { this.generation++; clearTimeout(this.timer); this.server?.close(); this.server=undefined;this.connecting=false }
  disconnect() { this.close();rmSync(join(this.directory,'auth.local'),{force:true});this.message='이 컴퓨터의 Plaud 연결을 해제했습니다. 내려받은 녹음은 보존됩니다.';return this.status() }
  private async json(path: string, init: RequestInit) {
    const r=await this.fetcher(BASE+path,{...init,redirect:'error',signal:AbortSignal.timeout(30_000)})
    if(!r.ok)throw new Error(r.status===429?'Plaud 요청이 잠시 제한됐습니다. 잠시 후 다시 시도하세요.':`Plaud 연결 요청 실패 (${r.status}). 다시 로그인하세요.`)
    return r.json() as Promise<any>
  }
  async connect(): Promise<PlaudStatus> {
    if(this.connecting)return this.status()
    this.connecting=true;this.message='브라우저에서 Plaud 로그인과 연결 승인을 완료하세요.'
    const generation=++this.generation, verifier=randomBytes(32).toString('base64url'),state=randomBytes(32).toString('base64url')
    let redirect='',clientId='',clientSecret:string|undefined,consumed=false
    this.server=createServer(async(req,res)=>{
      const u=new URL(req.url || '/', 'http://127.0.0.1')
      if(req.method!=='GET'||u.pathname!=='/callback'){res.writeHead(404).end();return}
      if(u.searchParams.get('state')!==state || consumed){res.writeHead(400).end('Invalid authorization response');return}
      consumed=true;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store')
      try {
        const code=u.searchParams.get('code');if(!code || u.searchParams.has('error'))throw new Error('Plaud 연결이 취소됐습니다.')
        const t=await this.json('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,...(clientSecret?{client_secret:clientSecret}:{}),code,redirect_uri:redirect,code_verifier:verifier,resource:BASE+'/mcp'})})
        if(generation!==this.generation || typeof t.access_token!=='string')throw new Error('연결을 다시 시작하세요.')
        this.save({clientId,clientSecret,accessToken:t.access_token,refreshToken:t.refresh_token,expiresAt:Date.now()+Number(t.expires_in||3600)*1000})
        this.message='Plaud 연결 완료. 녹음을 선택해 Yogurt에서 다시 전사할 수 있습니다.'
        res.end('<h2>Plaud 연결 완료</h2><p>이 창을 닫고 Achmage Yogurt로 돌아가세요.</p>')
      } catch(e) {this.message=e instanceof Error?e.message:'Plaud 연결 실패';res.writeHead(400).end('<h2>연결을 완료하지 못했습니다.</h2><p>Yogurt로 돌아가 다시 연결하세요.</p>')}
      finally {if(generation===this.generation)this.close()}
    })
    try {
      await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',resolve)})
      const address=this.server.address();if(!address||typeof address==='string')throw new Error('로그인 창을 준비하지 못했습니다.')
      redirect=`http://127.0.0.1:${address.port}/callback`
      // Official MCP server advertises dynamic registration and PKCE S256.
      const c=await this.json('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Achmage Yogurt',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})})
      if(generation!==this.generation)throw new Error('연결이 취소됐습니다.')
      if(typeof c.client_id!=='string')throw new Error('Plaud가 앱 연결을 등록하지 못했습니다.')
      clientId=c.client_id;clientSecret=c.client_secret
      const url=new URL(BASE+'/authorize');url.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',resource:BASE+'/mcp'}).toString()
      this.timer=setTimeout(()=>{this.message='로그인 시간이 지났습니다. 다시 연결하세요.';this.close()},180_000);this.timer.unref()
      await this.open(url.href);return this.status()
    } catch(e){this.close();this.message=e instanceof Error?e.message:'Plaud 연결 실패';throw e}
  }
  private async token(): Promise<Credentials> {
    const c=this.credentials();if(!c)throw new Error('먼저 Plaud 계정을 연결하세요.')
    if(c.expiresAt>Date.now()+60_000)return c
    if(!c.refreshToken)throw new Error('Plaud 로그인이 만료됐습니다. 다시 연결하세요.')
    const generation=this.generation
    return this.refresh ??= (async()=>{
      const t=await this.json('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:c.refreshToken!,client_id:c.clientId,...(c.clientSecret?{client_secret:c.clientSecret}:{}),resource:BASE+'/mcp'})})
      if(generation!==this.generation || typeof t.access_token!=='string')throw new Error('Plaud에 다시 연결하세요.')
      const next={...c,accessToken:t.access_token,refreshToken:t.refresh_token||c.refreshToken,expiresAt:Date.now()+Number(t.expires_in||3600)*1000};this.save(next);return next
    })().finally(()=>{this.refresh=undefined})
  }
  async call(name: 'list_files'|'get_file', args: Record<string,unknown>): Promise<any> {
    const credentials=await this.token(),client=new Client({name:'Achmage Yogurt',version:'0.6.2'})
    const transport=new StreamableHTTPClientTransport(new URL(BASE+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+credentials.accessToken}},fetch:(url,init)=>this.fetcher(url,{...init,redirect:'error',signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(45_000)])})})
    try {await client.connect(transport);return mcpData(await client.callTool({name,arguments:args},undefined,{timeout:45_000}))}
    catch(e){const s=e instanceof Error?e.message:'';throw new Error(/401|403|unauthor/i.test(s)?'Plaud 연결 승인이 만료됐습니다. 다시 로그인하세요.':/429/.test(s)?'Plaud 요청이 잠시 제한됐습니다. 잠시 후 다시 시도하세요.':'Plaud에서 자료를 가져오지 못했습니다. 연결과 네트워크를 확인하고 다시 시도하세요.')}
    finally {await client.close().catch(()=>{});await transport.close().catch(()=>{})}
  }
}
