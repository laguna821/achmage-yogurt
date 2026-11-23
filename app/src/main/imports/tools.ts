import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter,join } from 'node:path'

export function mediaTool(name:'ffmpeg'|'ffprobe'|'yt-dlp'):string {
  const exe=name+(process.platform==='win32'?'.exe':'')
  const dirs=[join(process.resourcesPath||'','tools'),join(process.cwd(),'resources/tools'),...(process.env.PATH||'').split(delimiter)]
  return dirs.map(d=>join(d,exe)).find(existsSync)||exe
}
export function mediaNode():string { const exe=process.platform==='win32'?'node.exe':'node'; return [join(process.resourcesPath||'','tools',exe),join(process.cwd(),'resources/tools',exe),...(process.env.PATH||'').split(delimiter).map(d=>join(d,exe))].find(existsSync)||exe }
export async function command(binary:string,args:string[],signal?:AbortSignal,onLine?:(text:string)=>void,extraEnv?:NodeJS.ProcessEnv):Promise<string>{
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],env:extraEnv?{...process.env,...extraEnv}:process.env,signal})
    let out='',err=''
    child.stdout.on('data',(b:Buffer)=>{out+=b.toString();if(out.length>4_000_000){child.kill();reject(new Error('도구 응답이 너무 큽니다.'))}onLine?.(b.toString())})
    child.stderr.on('data',(b:Buffer)=>{err=(err+b.toString()).slice(-2000);onLine?.(b.toString())})
    child.on('error',e=>reject(new Error(signal?.aborted?'작업을 중단했습니다.':`${binary} 실행 실패: ${e.message}`)))
    child.on('close',code=>code===0?resolve(out):reject(new Error(signal?.aborted?'작업을 중단했습니다.':err.trim()||'미디어 도구 실행에 실패했습니다.')))
  })
}
export async function* ffmpegDecode(file:string,signal?:AbortSignal):AsyncGenerator<Float32Array>{
  const child=spawn(mediaTool('ffmpeg'),['-nostdin','-v','error','-protocol_whitelist','file,pipe','-i',file,'-f','f32le','-ac','1','-ar','16000','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe'],signal})
  let error='',rest:Buffer=Buffer.alloc(0),failure:Error|undefined
  child.on('error',e=>{failure=e});child.stderr.on('data',(b:Buffer)=>{error=(error+b).slice(-1000)})
  const closed=new Promise<number|null>(r=>child.on('close',r))
  try{for await(const b of child.stdout as AsyncIterable<Buffer>){const all=rest.length?Buffer.concat([rest,b]):b,n=all.length-all.length%4;if(n)yield new Float32Array(all.buffer.slice(all.byteOffset,all.byteOffset+n));rest=all.subarray(n)}
    const code=await closed;if(failure||code!==0)throw failure||new Error(error||'오디오 디코딩 실패')
  }finally{if(child.exitCode===null)child.kill()}
}
