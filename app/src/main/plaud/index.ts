import { app, ipcMain, safeStorage, shell } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ImportManager } from '../imports'
import type { PlaudRecording, PlaudStatus } from '../../shared/plaud'
import { PlaudConnector } from './connector'
import { audioURL, recordingId, recordingList } from './data'

type Download = { id: string; bytes: number; total?: number }
type Receipt = { id: string; title: string; path: string; bytes: number; sha256: string; jobId?: string }
export class PlaudImports {
  private active?: { abort: AbortController; progress: Download }
  private pending=new Map<string,Promise<ReturnType<ImportManager['add']>>>()
  constructor(private root:string,private connector:Pick<PlaudConnector,'call'>,private imports:Pick<ImportManager,'list'|'add'>,private fetcher:typeof fetch=fetch) {mkdirSync(root,{recursive:true,mode:0o700})}
  status(){return this.active?.progress}
  cancel(){this.active?.abort.abort()}
  private key(id:string){return createHash('sha256').update(id).digest('hex')}
  private receipt(id:string):Receipt|undefined{try{return JSON.parse(readFileSync(join(this.root,this.key(id)+'.json'),'utf8'))}catch{return}}
  private save(r:Receipt){const p=join(this.root,this.key(r.id)+'.json');writeFileSync(p+'.tmp',JSON.stringify(r),{mode:0o600});renameSync(p+'.tmp',p)}
  async list(page:number):Promise<PlaudRecording[]>{
    if(!Number.isInteger(page)||page<1||page>1000)throw new Error('목록 페이지를 확인하세요.')
    return recordingList(await this.connector.call('list_files',{page,page_size:20})).map(r=>{const jobId=this.receipt(r.id)?.jobId,job=this.imports.list().find(j=>j.id===jobId);return {...r,jobId:job?.id,meetingId:job?.meetingId}})
  }
  import(raw:unknown){
    const id=recordingId(raw),pending=this.pending.get(id);if(pending)return pending
    if(this.active)throw new Error('현재 원음을 가져오는 중입니다. 완료 후 다음 녹음을 선택하세요.')
    const run=this.run(id).finally(()=>this.pending.delete(id));this.pending.set(id,run);return run
  }
  private async run(id:string){
    const prior=this.receipt(id),oldJob=this.imports.list().find(j=>j.id===prior?.jobId)
    if(oldJob)return oldJob
    const abort=new AbortController(),progress:Download={id,bytes:0};this.active={abort,progress}
    const part=join(this.root,this.key(id)+'.part')
    try {
      let receipt=prior
      if(!receipt||!existsSync(receipt.path)||statSync(receipt.path).size!==receipt.bytes){
        const raw=await this.connector.call('get_file',{file_id:id}),record=raw?.data||raw
        let url=audioURL(record.presigned_url),response:Response|undefined
        const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(30*60_000)])
        for(let hops=0;hops<4;hops++){
          response=await this.fetcher(url,{redirect:'manual',credentials:'omit',signal})
          if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();url=audioURL(new URL(location||'',url).href);continue}
          break
        }
        if(!response?.ok||!response.body)throw new Error('원음 다운로드에 실패했습니다. 다시 가져오면 새 다운로드 링크를 요청합니다.')
        const total=Number(response.headers.get('content-length'))||undefined;progress.total=total
        if(total&&total>10_000_000_000){await response.body.cancel();throw new Error('원음 파일은 10GB까지 가져올 수 있습니다.')}
        const type=response.headers.get('content-type')||''
        if(/text\/|json|xml|html/i.test(type)){await response.body.cancel();throw new Error('Plaud가 음성 대신 오류 응답을 반환했습니다. 잠시 후 다시 시도하세요.')}
        const ext=/wav/i.test(type)?'wav':/ogg/i.test(type)?'ogg':/webm/i.test(type)?'webm':/mp4|m4a/i.test(type)?'m4a':'mp3'
        const file=await open(part,'w',0o600),hash=createHash('sha256')
        try {for await(const chunk of response.body as any as AsyncIterable<Uint8Array>){if(signal.aborted)throw new Error('다운로드 중단');progress.bytes+=chunk.length;if(progress.bytes>10_000_000_000)throw new Error('원음 파일은 10GB까지 가져올 수 있습니다.');hash.update(chunk);await file.writeFile(chunk)}await file.sync()}finally{await file.close()}
        if(!progress.bytes||total&&progress.bytes!==total)throw new Error('원음 다운로드가 완성되지 않았습니다. 다시 시도하세요.')
        const path=join(this.root,this.key(id)+'.'+ext);renameSync(part,path)
        receipt={id,title:String(record.name||'Plaud 녹음').slice(0,200),path,bytes:progress.bytes,sha256:hash.digest('hex')};this.save(receipt)
      }
      if(abort.signal.aborted)throw new Error('가져오기를 중단했습니다.')
      // Pass AUDIO ONLY, including recordings already transcribed in Plaud. Yogurt performs fresh local ASR.
      const job=this.imports.add({paths:[receipt.path],title:receipt.title,externalSource:{provider:'plaud',id}})
      receipt.jobId=job.id;this.save(receipt);return job
    } catch(e){if(abort.signal.aborted)throw new Error('가져오기를 중단했습니다. Plaud 원본은 그대로 보존됩니다.');throw e}
    finally {await rm(part,{force:true});this.active=undefined}
  }
}
export function hookPlaud(root:string,imports:ImportManager){
  const directory=join(root,'plaud')
  const connector=new PlaudConnector(directory,{
    encode:text=>safeStorage.isEncryptionAvailable()?Buffer.concat([Buffer.from([1]),safeStorage.encryptString(text)]):Buffer.concat([Buffer.from([0]),Buffer.from(text)]),
    decode:bytes=>bytes[0]===1?safeStorage.decryptString(bytes.subarray(1)):bytes.subarray(1).toString(),
  },url=>shell.openExternal(url))
  const downloads=new PlaudImports(join(directory,'recordings'),connector,imports)
  const status=():PlaudStatus=>({...connector.status(),downloading:downloads.status()})
  ipcMain.handle('plaud:status',status)
  ipcMain.handle('plaud:connect',async()=>{await connector.connect();return status()})
  ipcMain.handle('plaud:disconnect',()=>{if(downloads.status())throw new Error('원음 가져오기를 중단한 뒤 연결을 해제하세요.');connector.disconnect();return status()})
  ipcMain.handle('plaud:list',(_e,page:unknown)=>downloads.list(Number(page)))
  ipcMain.handle('plaud:import',(_e,id:unknown)=>downloads.import(id))
  ipcMain.handle('plaud:cancel',()=>downloads.cancel())
  app.on('will-quit',()=>{downloads.cancel();connector.close()})
}
