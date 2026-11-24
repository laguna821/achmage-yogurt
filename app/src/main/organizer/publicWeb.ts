import{lookup}from'node:dns/promises'
import{isIP}from'node:net'
const privateAddress=(s:string)=>/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|fe80)/i.test(s)||s.startsWith('::ffff:')
export async function assertPublicUrl(url:string|URL):Promise<URL>{
  const current=new URL(url)
  if(!['https:','http:'].includes(current.protocol)||current.username||current.password||current.port&&!['80','443'].includes(current.port))throw new Error('공개 웹 주소만 읽을 수 있습니다.')
  const hosts=isIP(current.hostname)?[{address:current.hostname}]:await lookup(current.hostname,{all:true})
  if(!hosts.length||hosts.some(h=>privateAddress(h.address)))throw new Error('내부 네트워크 주소는 읽지 않습니다.')
  return current
}
export async function publicText(url:string,signal?:AbortSignal):Promise<string>{
  let current=new URL(url)
  for(let n=0;n<4;n++){
    await assertPublicUrl(current)
    const response=await fetch(current,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20_000)]):AbortSignal.timeout(20_000),headers:{'User-Agent':'Achmage-Yogurt/0.4 (public source reading)'}})
    if(response.status>=300&&response.status<400){current=new URL(response.headers.get('location')||'',current);continue}
    if(!response.ok||!/(text\/|application\/xhtml)/i.test(response.headers.get('content-type')||''))throw new Error('웹 본문을 읽지 못했습니다.')
    const reader=response.body?.getReader();if(!reader)throw new Error('빈 웹 자료입니다.')
    const chunks:Uint8Array[]=[];let length=0
    try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>1_000_000)break;chunks.push(r.value)}}finally{await reader.cancel()}
    return Buffer.concat(chunks).toString('utf8')
  }
  throw new Error('웹 자료의 리디렉션이 너무 많습니다.')
}
export const webPlain=(html:string)=>html.replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(p|div|h[1-6]|li|tr|section)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>Number(n)<=0x10ffff?String.fromCodePoint(Number(n)):'').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim()
