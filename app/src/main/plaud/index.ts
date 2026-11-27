import { app, ipcMain, safeStorage, shell } from 'electron'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Evidence } from '../../shared/organizer'
import type { ImportManager } from '../imports'
import type { PlaudRecording, PlaudStatus, PlaudImportOptions } from '../../shared/plaud'
import { PlaudConnector } from './connector'
import { audioURL, recordingId, recordingList, transcriptPage, plaudNotes } from './data'

type Download = { id: string; bytes: number; total?: number }
type Receipt = { id: string; title: string; path?: string; bytes?: number; sha256?: string; jobId?: string; transcriptJobId?: string }
export class PlaudImports {
  private active?: { abort: AbortController; progress: Download }
  private pending=new Map<string,Promise<ReturnType<ImportManager['add']>>>()
  constructor(private root:string,private connector:Pick<PlaudConnector,'call'>,private imports:Pick<ImportManager,'list'|'add'|'provideTranscript'|'attachAudio'|'audioState'|'usable'>,private fetcher:typeof fetch=fetch,private prepared?:(id:string,participants:string[],materials:Evidence[],notice:string)=>void) {mkdirSync(root,{recursive:true,mode:0o700})}
  status(){return this.active?.progress}
  cancel(){this.active?.abort.abort()}
  cancelMeeting(id:string){if(this.active&&this.imports.list().some(j=>j.meetingId===id&&j.externalSource?.id===this.active?.progress.id))this.cancel()}
  private key(id:string){return createHash('sha256').update(id).digest('hex')}
  private receipt(id:string):Receipt|undefined{try{return JSON.parse(readFileSync(join(this.root,this.key(id)+'.json'),'utf8'))}catch{return}}
  private save(r:Receipt){const p=join(this.root,this.key(r.id)+'.json');writeFileSync(p+'.tmp',JSON.stringify({...this.receipt(r.id),...r}),{mode:0o600});renameSync(p+'.tmp',p)}
  async list(page:number):Promise<PlaudRecording[]>{
    if(!Number.isInteger(page)||page<1||page>1000)throw new Error('목록 페이지를 확인하세요.')
    return recordingList(await this.connector.call('list_files',{page,page_size:20})).map(r=>{const receipt=this.receipt(r.id),job=this.imports.list().find(j=>j.id===(receipt?.transcriptJobId||receipt?.jobId)&&this.imports.usable(j));return {...r,jobId:job?.id,meetingId:job?.meetingId}})
  }
  import(raw:unknown,options:PlaudImportOptions={mode:'transcript'}){
    if(!options||!['transcript','local'].includes(options.mode))throw new Error('가져오기 방식을 확인하세요.')
    const id=recordingId(raw),key=id+':'+options.mode,pending=this.pending.get(key);if(pending)return pending
    if(this.active)throw new Error('현재 Plaud 자료를 가져오는 중입니다. 완료하거나 중단한 뒤 다시 시도하세요.')
    const run=this.run(id,options).finally(()=>this.pending.delete(key));this.pending.set(key,run);return run
  }
  private async transcript(id:string,signal:AbortSignal){
    let cursor:string|undefined,total:number|undefined;const seen=new Set<string>(),turns:ReturnType<typeof transcriptPage>['turns']=[],pages:unknown[]=[]
    let size=0
    do {
      if(signal.aborted)throw new Error('가져오기를 중단했습니다.')
      const raw=await this.connector.call('get_transcript',{file_id:id,block:'transaction',limit:500,...(cursor?{cursor}:{})})
      size+=JSON.stringify(raw).length
      if(size>20_000_000||pages.length>=200)throw new Error('전사 크기가 가져오기 한도를 넘었습니다. 파일로 나누어 가져오세요.')
      const page=transcriptPage(raw,turns.length,id)
      if(total!==undefined&&page.total!==total)throw new Error('가져오는 동안 Plaud 전사가 변경됐습니다. 다시 시도하세요.')
      total=page.total;turns.push(...page.turns);pages.push(raw);cursor=page.next
      if(cursor){if(seen.has(cursor))throw new Error('Plaud 전사 페이지가 반복됐습니다. 다시 시도하세요.');seen.add(cursor)}
    }while(cursor)
    if(!turns.some(t=>t.text.trim()))throw new Error('Plaud에 기존 전사가 없습니다. ‘원음으로 새로 전사’를 선택하거나 전사 파일을 가져오세요.')
    if(signal.aborted)throw new Error('가져오기를 중단했습니다.')
    const path=join(this.root,this.key(id)+'-transcript.json')
    writeFileSync(path,JSON.stringify(turns),{mode:0o600})
    writeFileSync(join(this.root,this.key(id)+'-transcript-source.json'),JSON.stringify(pages),{mode:0o600})
    return {path,participants:[...new Set(turns.map(t=>t.speaker).filter((v):v is string=>!!v))]}
  }
  private async run(id:string,options:PlaudImportOptions){
    const prior=this.receipt(id),priorId=options.mode==='local'?prior?.jobId:prior?.transcriptJobId
    const oldJob=this.imports.list().find(j=>j.id===priorId&&this.imports.usable(j)&&!['failed','cancelled'].includes(j.stage))
    if(options.mode==='local'&&oldJob)return oldJob
    const abort=new AbortController(),progress:Download={id,bytes:0};this.active={abort,progress}
    const part=join(this.root,this.key(id)+'.part')
    let background=false
    try {
      if(options.mode==='transcript'){
        let job=oldJob
        if(!job){
          const raw=await this.connector.call('get_file',{file_id:id}),record=raw?.data||raw
          const transcript=await this.transcript(id,abort.signal)
          const date=typeof record.start_at==='string'?Date.parse(record.start_at):NaN
          let summary='',notice=''
          try{summary=plaudNotes(await this.connector.call('get_note',{file_id:id}));if(!summary)notice='Plaud 정리본이 없어 raw 전사만 가져왔습니다.'}
          catch{notice='Plaud 정리본을 가져오지 못했습니다. raw 전사로 정리할 수 있고, 필요하면 정리본을 따로 첨부하세요.'}
          if(abort.signal.aborted)throw new Error('가져오기를 중단했습니다.')
          job=await this.imports.provideTranscript({paths:[transcript.path],title:String(record.name||'Plaud 녹음').slice(0,200),externalSource:{provider:'plaud',id}},date)
          this.save({id,title:job.title,transcriptJobId:job.id})
          if(job.meetingId)this.prepared?.(job.meetingId,transcript.participants,summary?[{
            id:'plaud-notes',provider:'attached',title:'Plaud 정리본 · AI 생성 보조 자료',locator:'plaud:'+id+'/notes',
            text:'[Plaud가 작성한 기존 정리본입니다. 오류·누락 가능성이 있는 보조 자료이며 raw 전사를 우선 대조하세요.]\n\n'+summary,
            revision:createHash('sha256').update(summary).digest('hex'),issueIds:[],
          }]:[],notice)
        }
        if(options.keepAudio&&job.audioStatus!=='saved'){
          this.imports.audioState(job.id,'pending','원음을 별도로 보관 중입니다. 정리는 지금 시작할 수 있습니다.')
          const jobId=job.id
          // The transcript is already usable. Audio failure must never roll it back.
          void this.download(id,abort,progress).then(r=>this.imports.attachAudio(jobId,r.path,abort.signal)).catch(()=>{
            this.imports.audioState(jobId,'failed',abort.signal.aborted?'원음 보관을 중단했습니다. 전사와 정리 문서는 보존됩니다.':'원음을 보관하지 못했습니다. Plaud에서 같은 녹음을 선택해 다시 시도하세요. 전사는 보존됩니다.')
          }).finally(async()=>{await rm(part,{force:true});this.active=undefined})
          background=true
        }
        return this.imports.list().find(j=>j.id===job!.id)!
      }
      const receipt=await this.download(id,abort,progress)
      if(abort.signal.aborted)throw new Error('가져오기를 중단했습니다.')
      const job=this.imports.add({paths:[receipt.path],title:receipt.title,externalSource:{provider:'plaud',id}})
      this.save({...receipt,jobId:job.id});return job
    } catch(e){if(abort.signal.aborted)throw new Error('가져오기를 중단했습니다. Plaud 원본은 그대로 보존됩니다.');throw e}
    finally {if(!background){await rm(part,{force:true});this.active=undefined}}
  }
  private async download(id:string,abort:AbortController,progress:Download){
    const prior=this.receipt(id)
    if(prior?.path&&existsSync(prior.path)&&statSync(prior.path).size===prior.bytes)return prior as Receipt & {path:string}
    const part=join(this.root,this.key(id)+'.part')
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
        const receipt:Receipt={id,title:String(record.name||'Plaud 녹음').slice(0,200),path,bytes:progress.bytes,sha256:hash.digest('hex')};this.save(receipt);return receipt as Receipt & {path:string}
  }
}
export function hookPlaud(root:string,imports:ImportManager,prepared?:(id:string,participants:string[],materials:Evidence[],notice:string)=>void){
  const directory=join(root,'plaud')
  const connector=new PlaudConnector(directory,{
    encode:text=>safeStorage.isEncryptionAvailable()?Buffer.concat([Buffer.from([1]),safeStorage.encryptString(text)]):Buffer.concat([Buffer.from([0]),Buffer.from(text)]),
    decode:bytes=>bytes[0]===1?safeStorage.decryptString(bytes.subarray(1)):bytes.subarray(1).toString(),
  },url=>shell.openExternal(url))
  const downloads=new PlaudImports(join(directory,'recordings'),connector,imports,fetch,prepared)
  const status=():PlaudStatus=>({...connector.status(),downloading:downloads.status()})
  ipcMain.handle('plaud:status',status)
  ipcMain.handle('plaud:connect',async()=>{await connector.connect();return status()})
  ipcMain.handle('plaud:disconnect',()=>{if(downloads.status())throw new Error('원음 가져오기를 중단한 뒤 연결을 해제하세요.');connector.disconnect();return status()})
  ipcMain.handle('plaud:list',(_e,page:unknown)=>downloads.list(Number(page)))
  ipcMain.handle('plaud:import',(_e,id:unknown,options:PlaudImportOptions)=>downloads.import(id,options))
  ipcMain.handle('plaud:cancel',()=>downloads.cancel())
  app.on('will-quit',()=>{downloads.cancel();connector.close()})
  return downloads
}
