import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GmailConnector, GMAIL_SCOPE, messageText } from '../src/main/organizer/gmail'
const dirs:string[]=[]
afterEach(()=>dirs.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})))
describe('native Gmail read-only connection',()=>{
  it('uses PKCE and a checked loopback state, persists login and reads only the selected messages',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'yogurt-gmail-'));dirs.push(dir);const requests:{url:string;method:string}[]=[]
    const fetcher:typeof fetch=async(input,init)=>{
      const url=String(input);requests.push({url,method:init?.method||'GET'})
      if(url.includes('oauth2.googleapis.com/token')){expect(String(init?.body)).toContain('code_verifier=');return Response.json({access_token:'TEST_ACCESS',refresh_token:'TEST_REFRESH',expires_in:3600,scope:GMAIL_SCOPE})}
      if(url.endsWith('/profile'))return Response.json({emailAddress:'test@example.com'})
      if(url.includes('/messages?'))return Response.json({messages:[{id:'abcd1234'}]})
      return Response.json({payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'워크숍 일정'}],body:{data:Buffer.from('1월 12일 제안').toString('base64url')}}})
    }
    const client=new GmailConnector(dir,undefined,fetcher);client.configure({installed:{client_id:'test.apps.googleusercontent.com',client_secret:'TEST_CLIENT'}})
    let auth!:URL;await client.connect(async url=>{auth=new URL(url)})
    expect(auth.searchParams.get('scope')).toBe(GMAIL_SCOPE);expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    const callback=new URL(auth.searchParams.get('redirect_uri')!);callback.search=new URLSearchParams({code:'TEST_CODE',state:'bad'}).toString()
    expect((await fetch(callback)).status).toBe(400);expect(client.status().connected).toBe(false)
    callback.searchParams.set('state',auth.searchParams.get('state')!);expect((await fetch(callback)).status).toBe(200)
    expect(client.status()).toMatchObject({connected:true,account:'test@example.com'})
    const evidence=await client.search('after:2026/11/01 워크숍');expect(evidence[0].text).toContain('1월 12일 제안')
    expect(requests.filter(r=>r.url.includes('gmail.googleapis.com')).every(r=>r.method==='GET')).toBe(true)
    await client.disconnect();expect(client.status().connected).toBe(false)
  })
  it('ignores binary attachments while extracting a message body',()=>{
    expect(messageText({mimeType:'image/png',body:{data:Buffer.from('binary').toString('base64url')}})).toBe('')
  })
})
