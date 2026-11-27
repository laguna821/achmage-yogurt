import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron',()=>({app:{on:vi.fn()},ipcMain:{handle:vi.fn()},safeStorage:{},shell:{}}))
import { PlaudConnector } from '../src/main/plaud/connector'
import { PlaudImports } from '../src/main/plaud'
import { audioURL, mcpData, recordingList } from '../src/main/plaud/data'
const dirs:string[]=[]
const temp=()=>{const d=mkdtempSync(join(tmpdir(),'yogurt-plaud-'));dirs.push(d);return d}
afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
const codec={encode:(s:string)=>Buffer.from(s),decode:(b:Buffer)=>b.toString()}
it('reads official wrapped data without treating metadata as instructions',()=>{
  const value={data:[{id:'abc-123',name:'강의 한국어 English',duration:60000,start_at:'2026-11-27T00:00:00Z'}]}
  expect(recordingList(mcpData({content:[{type:'text',text:'<untrusted_data>\n'+JSON.stringify(value)+'\n</untrusted_data>'}]}))[0]).toMatchObject({id:'abc-123',durationMs:60000})
  expect(()=>mcpData({isError:true,content:[{type:'text',text:'secret'}]})).toThrow('Plaud 요청')
  expect(()=>recordingList({data:[{id:'../../secret'}]})).toThrow()
  for(const u of ['http://bucket.s3.amazonaws.com/a','https://127.0.0.1/private','https://plaud.ai.evil.test/a','file:///etc/passwd','https://user:pass@plaud.ai/a'])expect(()=>audioURL(u)).toThrow()
})
it('checks OAuth state, binds PKCE and supports cancellation without storing credentials',async()=>{
  const dir=temp();let browser='';const requests:{url:string;init:any}[]=[]
  const fake=vi.fn(async(url:any,init:any)=>{requests.push({url:String(url),init});return new Response(JSON.stringify(String(url).endsWith('/register')?{client_id:'test-client'}:{access_token:'test-token',refresh_token:'test-refresh',expires_in:3600}),{headers:{'content-type':'application/json'}})}) as unknown as typeof fetch
  const c=new PlaudConnector(dir,codec,async u=>{browser=u},fake)
  try {
    expect((await c.connect()).connecting).toBe(true)
    const auth=new URL(browser),callback=new URL(auth.searchParams.get('redirect_uri')!)
    callback.search=new URLSearchParams({code:'code',state:'wrong'}).toString()
    expect((await fetch(callback)).status).toBe(400);expect(c.status().connected).toBe(false)
    callback.search=new URLSearchParams({code:'code',state:auth.searchParams.get('state')!}).toString()
    expect((await fetch(callback)).status).toBe(200);expect(c.status().connected).toBe(true)
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    const token=requests.find(r=>r.url.endsWith('/token'))!;expect(token.init.body.get('code_verifier')).toHaveLength(43)
    expect(token.init.body.get('redirect_uri')).toBe(auth.searchParams.get('redirect_uri'))
    c.disconnect();expect(c.status().connected).toBe(false)
    await c.connect();c.disconnect();expect(c.status().connecting).toBe(false)
  } finally {c.close()}
})
it('downloads audio from an already-transcribed recording, queues audio only and deduplicates',async()=>{
  const root=temp(),call=vi.fn(async()=>({data:{id:'record-1',name:'강의',presigned_url:'https://test.s3.amazonaws.com/audio',source_list:[{text:'existing transcript'}],note_list:[{text:'existing summary'}]}}))
  const bytes=Buffer.from('ID3 original audio bytes'),fetcher=vi.fn(async()=>new Response(bytes,{headers:{'content-type':'audio/mpeg','content-length':String(bytes.length)}})) as unknown as typeof fetch
  const jobs:any[]=[],add=vi.fn((r:any)=>{const j={id:'job-1',...r};jobs.push(j);return j})
  const imports=new PlaudImports(root,{call},{list:()=>jobs,add},fetcher)
  const job=await imports.import('record-1');expect(job.id).toBe('job-1');expect(add.mock.calls[0][0].paths).toHaveLength(1)
  expect(readFileSync(add.mock.calls[0][0].paths[0])).toEqual(bytes);expect(job.externalSource).toEqual({provider:'plaud',id:'record-1'})
  expect(call).toHaveBeenCalledWith('get_file',{file_id:'record-1'});expect(await imports.import('record-1')).toEqual(job);expect(add).toHaveBeenCalledTimes(1)
  expect(readdirSync(root).some(n=>n.endsWith('.part'))).toBe(false)
})
it('rejects an incomplete download without creating a transcription job',async()=>{
  const root=temp(),call=vi.fn(async()=>({presigned_url:'https://test.s3.amazonaws.com/audio'})),add=vi.fn()
  const imports=new PlaudImports(root,{call},{list:()=>[],add},(async()=>new Response('ID3 short',{headers:{'content-length':'999','content-type':'audio/mpeg'}})) as typeof fetch)
  await expect(imports.import('record-2')).rejects.toThrow('완성되지');expect(add).not.toHaveBeenCalled();expect(readdirSync(root)).toEqual([])
})
it('cancels a pending download and keeps it out of the ASR queue',async()=>{
  const root=temp(),call=vi.fn(async()=>({presigned_url:'https://test.s3.amazonaws.com/audio'})),add=vi.fn()
  const imports=new PlaudImports(root,{call},{list:()=>[],add},(async(_url,init)=>new Promise((_resolve,reject)=>{init!.signal!.addEventListener('abort',()=>reject(new Error('cancelled')))})) as typeof fetch)
  const pending=imports.import('record-3');await vi.waitFor(()=>expect(imports.status()?.id).toBe('record-3'));await new Promise(r=>setTimeout(r,10));imports.cancel()
  await expect(pending).rejects.toThrow('중단');expect(add).not.toHaveBeenCalled();expect(imports.status()).toBeUndefined()
})
it('uses MCP initialize and tools/call with the saved token; never requests transcription',async()=>{
  const dir=temp(),calls:string[]=[]
  const {writeFileSync}=await import('node:fs')
  writeFileSync(join(dir,'auth.local'),JSON.stringify({clientId:'test-client',accessToken:'secret-access',expiresAt:Date.now()+3600000}))
  const fake=(async(_url:any,init:any)=>{
    if(init?.method==='GET')return new Response(null,{status:405})
    const body=JSON.parse(init.body);calls.push(body.method)
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret-access')
    if(body.method==='notifications/initialized')return new Response(null,{status:202})
    const result=body.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'Plaud fixture',version:'1'}}:{content:[{type:'text',text:JSON.stringify({data:[{id:'record-1',name:'Already transcribed',duration:1000}]})}]}
    if(body.method==='tools/call')expect(body.params).toEqual({name:'list_files',arguments:{page:1,page_size:20}})
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{headers:{'content-type':'application/json'}})
  }) as typeof fetch
  const connector=new PlaudConnector(dir,codec,async()=>{},fake)
  expect(recordingList(await connector.call('list_files',{page:1,page_size:20}))[0].id).toBe('record-1')
  expect(calls).toContain('initialize');expect(calls.filter(c=>c==='tools/call')).toHaveLength(1)
})
