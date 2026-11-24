import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createHash,randomUUID } from 'node:crypto'
import { createReadStream,existsSync,mkdirSync,readFileSync,readdirSync,renameSync,statSync,writeFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { basename,extname,join } from 'node:path'
import type { Store } from '../store'
import { importMaterial } from '../organizer/runtime'
import { MEDIA_EXTS,TRANSCRIPT_EXTS,parseTranscript,youtubeUrl,type ImportFile,type ImportJob,type ImportRequest,type ImportStage } from '../../shared/imports'
import { command,ffmpegDecode,mediaTool } from './tools'
import { downloadYouTube, youtubeImportError } from './youtube'
import { videoOptions, type VideoOptions } from '../../shared/video'

const errorText=(e:unknown)=>e instanceof Error?e.message:String(e)
const hashFile=(file:string)=>new Promise<string>((resolve,reject)=>{const h=createHash('sha256'),r=createReadStream(file);r.on('data',b=>h.update(b));r.on('error',reject);r.on('end',()=>resolve(h.digest('hex')))})
export function importedTranscriptInfo(root:string,id:unknown):{timed:boolean;kind:string}|undefined{
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return
  try{const d=JSON.parse(readFileSync(join(root,'meetings',id,'import-transcript.json'),'utf8'));return {timed:d.timed!==false,kind:String(d.kind)}}catch{return}
}
export function describeFile(path:string):ImportFile {
  if(typeof path!=='string'||!path||path.includes('\0'))throw new Error('파일 경로를 확인하세요.')
  const stat=statSync(path),ext=extname(path).slice(1).toLowerCase()
  if(TRANSCRIPT_EXTS.includes(ext)&&stat.size>20_000_000)throw new Error('전사 문서 한 개는 20MB까지 가져올 수 있습니다.')
  if(!stat.isFile()||stat.size>10_000_000_000)throw new Error('일반 파일을 선택하세요. 파일 한 개는 10GB까지 지원합니다.')
  if(!MEDIA_EXTS.includes(ext)&&!TRANSCRIPT_EXTS.includes(ext))throw new Error('지원하지 않는 파일 형식: '+ext)
  return {path,name:basename(path),bytes:stat.size,kind:MEDIA_EXTS.includes(ext)?'media':'transcript'}
}
type Deps={completed?:(id:string,options?:VideoOptions)=>void;root:string;store:Store;window:()=>BrowserWindow|undefined;changed:()=>void;available:()=>boolean;recording:()=>boolean;transcribe:(id:string,tracks:{them:AsyncIterable<Float32Array>},stop:()=>boolean)=>Promise<boolean>}
export class ImportManager {
  private jobs=new Map<string,ImportJob>();private current?:{id:string;abort:AbortController};private scheduled=false
  constructor(private d:Deps){
    mkdirSync(this.jobDir(),{recursive:true})
    for(const name of readdirSync(this.jobDir()).filter(n=>n.endsWith('.json'))){try{const j=JSON.parse(readFileSync(join(this.jobDir(),name),'utf8')) as ImportJob
      if(!/^[a-f0-9-]{36}$/.test(j.id))continue
      if(j.stage==='failed' && j.url && /429|too many requests/i.test(j.message))j.errorDetail=j.message
      if(!['done','failed','cancelled','waiting','interrupted'].includes(j.stage)){j.stage='interrupted';j.message='앱이 종료되어 중단됐습니다. 원본을 보존했습니다. 다시 시작할 수 있습니다.'}
      this.jobs.set(j.id,j)
    }catch{/* A damaged job never affects the meeting database. */}}
  }
  get running(){return !!this.current}
  private jobDir(){return join(this.d.root,'imports')}
  list(){return [...this.jobs.values()].sort((a,b)=>b.createdAt-a.createdAt).map(j=>structuredClone(j))}
  private save(j:ImportJob,stage:ImportStage,message:string){j.stage=stage;j.message=message;j.updatedAt=Date.now();this.jobs.set(j.id,j);const p=join(this.jobDir(),j.id+'.json');writeFileSync(p+'.tmp',JSON.stringify(j,null,2),{mode:0o600});renameSync(p+'.tmp',p);this.d.window()?.webContents.send('imports:changed',this.list());this.d.changed()}
  add(raw:ImportRequest){
    if(!raw||typeof raw!=='object')throw new Error('가져올 자료를 확인하세요.')
    const files=Array.isArray(raw.paths)?raw.paths.map(describeFile):[]
    const url=raw.url?youtubeUrl(raw.url):undefined
    if((!files.length&&!url)||files.length>2||files.filter(f=>f.kind==='media').length>1||files.filter(f=>f.kind==='transcript').length>1||url&&files.length)throw new Error('음성/동영상 1개와 전사 1개를 함께 넣거나 YouTube 링크를 입력하세요.')
    const start=Number(raw.start||0),end=raw.end==null||raw.end===0?undefined:Number(raw.end)
    if(!Number.isFinite(start)||start<0||end!==undefined&&(!Number.isFinite(end)||end<=start))throw new Error('영상 구간의 시작/종료 초를 확인하세요.')
    const j:ImportJob={video:url&&raw.video?videoOptions(raw.video):undefined,id:randomUUID(),title:typeof raw.title==='string'&&raw.title.trim()?raw.title.trim().slice(0,200):files[0]?.name.replace(/\.[^.]+$/,'')||'YouTube 영상',files,url,caption:!!raw.caption,start,end,stage:'queued',message:'가져오기를 기다리고 있습니다.',createdAt:Date.now(),updatedAt:Date.now()}
    this.save(j,'queued',j.message);this.kick();return structuredClone(j)
  }
  cancel(id:string){const j=this.jobs.get(id);if(!j||j.stage==='done')return;if(this.current?.id===id)this.current.abort.abort();this.save(j,'cancelled','작업을 중단했습니다. 원본과 완료된 단계는 남아 있습니다.')}
  retry(id:string){const j=this.jobs.get(id);if(!j||this.current?.id===id||j.stage==='done')return;this.save(j,'queued','완료된 파일을 재사용해 다시 시작합니다.');this.kick()}
  kick(){if(this.scheduled)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;void this.runNext()})}
  private async runNext(){
    if(this.current||this.d.recording())return
    const j=[...this.jobs.values()].find(j=>j.stage==='queued'||j.stage==='waiting'&&this.d.available());if(!j)return
    const abort=new AbortController();this.current={id:j.id,abort}
    try{await this.run(j,abort.signal)}catch(e){j.errorDetail=errorText(e).slice(0,2000);this.save(j,abort.signal.aborted?'cancelled':'failed',j.url&&!abort.signal.aborted?youtubeImportError(j.errorDetail):j.errorDetail.slice(0,1000))}finally{this.current=undefined;this.kick()}
  }
  private async run(j:ImportJob,signal:AbortSignal){
    const meeting=j.meetingId?this.d.store.meeting(j.meetingId):undefined
    if(j.meetingId&&!meeting)throw new Error('가져온 기록이 삭제됐습니다. 새 작업으로 가져오세요.')
    if(!j.meetingId){const now=Date.now(),m=this.d.store.createMeeting({title:j.title,titleSource:'user',startedAt:now,endedAt:now,state:'stopped',eventId:null,app:null,attendees:[],language:'korean'});j.meetingId=m.id}
    const id=j.meetingId,dir=join(this.d.root,'meetings',id),original=join(dir,'original');mkdirSync(original,{recursive:true})
    // Persist identity before the first network/model step, including failed or interrupted imports.
    const saveSource=()=>{const path=join(dir,'import-source.json');writeFileSync(path+'.tmp',JSON.stringify({jobId:j.id,url:j.url,video:j.video,caption:!!j.caption,transcriptSource:j.transcriptSource,captionLanguage:j.captionLanguage,captionAutomatic:j.captionAutomatic,captionFallback:j.captionFallback,start:j.start,end:j.end,assets:j.assets,importedAt:j.createdAt},null,2),{mode:0o600});renameSync(path+'.tmp',path)}
    saveSource();this.save(j,j.url?'downloading':'copying',j.url?'YouTube 원본을 준비하고 있습니다.':'원본 자료를 준비하고 있습니다.')
    const originals:string[]=[];j.assets??=[]
    for(const [n,file]of j.files.entries()){
      if(signal.aborted)throw new Error('작업을 중단했습니다.')
      const dest=join(original,`${n}-${file.name}`)
      if(!existsSync(dest)){this.save(j,'copying',file.name+' 원본을 보관하고 있습니다.');await copyFile(file.path,dest)}
      if(!j.assets[n])j.assets[n]={name:basename(dest),bytes:statSync(dest).size,sha256:await hashFile(dest)}
      originals.push(dest)
    }
    let audio=j.files.findIndex(f=>f.kind==='media')>=0?originals[j.files.findIndex(f=>f.kind==='media')]:undefined
    let transcript=j.files.findIndex(f=>f.kind==='transcript')>=0?originals[j.files.findIndex(f=>f.kind==='transcript')]:undefined
    if(j.url){
      // Older failed jobs also skip the already rate-limited caption endpoint on retry.
      if(j.caption && /429|too many requests/i.test(j.errorDetail || j.captionFallback || ''))j.captionFallback ||= 'YouTube 자막 요청 제한(429): 음성 전사로 전환합니다.'
      const downloaded=await downloadYouTube({directory:original,url:j.url,captions:!!j.caption,skipCaptions:!!j.captionFallback,signal,
        onInfo:data=>{j.title=String(data.title||j.title).slice(0,200);this.d.store.updateMeeting(id,{title:j.title})},
        onProgress:message=>this.save(j,'downloading',message),
        onFallback:(message,detail)=>{j.captionFallback=message;j.errorDetail=detail;this.save(j,'downloading',message)}
      })
      audio=downloaded.audio;transcript=downloaded.transcript
      j.transcriptSource=transcript?'youtube-captions':'local-asr';j.captionLanguage=downloaded.track?.language;j.captionAutomatic=downloaded.track?.automatic
      for(const path of [audio,transcript].filter((p):p is string=>!!p))if(!j.assets.some(a=>a.name===basename(path)))j.assets.push({name:basename(path),bytes:statSync(path).size,sha256:await hashFile(path)})
    }
    let duration=0
    if(audio){
      const playback=join(dir,'them.ogg')
      if(!existsSync(playback)){
        this.save(j,'converting','재생과 전사를 위한 오디오를 준비하고 있습니다. 원본은 따로 보존됩니다.')
        const temp=join(dir,'them.import.ogg'),section=j.url?[...(j.start?['-ss',String(j.start)]:[]),...(j.end?['-t',String(j.end-(j.start||0))]:[])]:[]
        await command(mediaTool('ffmpeg'),['-nostdin','-y','-v','error','-protocol_whitelist','file,pipe',...section,'-i',audio,'-map','0:a:0','-vn','-ac','1','-c:a','libopus','-b:a','64k',temp],signal);renameSync(temp,playback)
      }
      duration=Number((await command(mediaTool('ffprobe'),['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',playback],signal)).trim())*1000
      if(!Number.isFinite(duration)||duration<=0)throw new Error('오디오 길이를 확인하지 못했습니다.')
    }
    if(transcript){
      this.save(j,'copying','기존 전사 원문과 시간·화자 표기를 가져오고 있습니다. 재전사는 생략합니다.')
      const ext=extname(transcript).slice(1).toLowerCase(),raw=['docx','pdf'].includes(ext)?(await importMaterial(transcript,'import',signal)).text:readFileSync(transcript,'utf8')
      if(raw.length>2_000_000)throw new Error('전사 원문은 200만 자까지 가져올 수 있습니다.')
      const parsed=parseTranscript(raw,ext),turns=j.url&&j.caption&&parsed.timed?parsed.turns.filter(t=>t.endMs>(j.start||0)*1000&&(!j.end||t.startMs<j.end*1000)).map(t=>({...t,startMs:Math.max(0,t.startMs-(j.start||0)*1000),endMs:Math.min(t.endMs,j.end?j.end*1000:Infinity)-(j.start||0)*1000})):parsed.turns
      if(!turns.length)throw new Error('선택한 범위에 전사 내용이 없습니다.')
      if(!existsSync(join(dir,'import-transcript.json'))){
        const existing=this.d.store.segments(id)
        if(existing.length&&JSON.stringify(existing.map(s=>({text:s.text,startMs:s.startMs,endMs:s.endMs,speaker:s.speaker})))!==JSON.stringify(turns.map(s=>({text:s.text,startMs:s.startMs,endMs:s.endMs,speaker:s.speaker}))))throw new Error('기록에 이미 다른 전사가 있습니다. 기존 전사를 보존했습니다.')
        if(!existing.length)this.d.store.addSegments(turns.map(t=>({...t,meetingId:id,track:'them' as const})))
        writeFileSync(join(dir,'import-transcript.json'),JSON.stringify({timed:parsed.timed,source:basename(transcript),kind:j.caption?'youtube-captions':'provided-transcript',turns},null,2),{mode:0o600})
      }
      duration=duration||Math.max(0,...turns.map(t=>t.endMs))
      this.d.store.updateMeeting(id,{transcriptionPending:false})
    }else if(audio){
      if(!this.d.available()){this.save(j,'waiting','전사 모델 준비 또는 현재 녹음 종료를 기다립니다. 원본과 변환 오디오는 저장됐습니다.');return}
      const prior=this.d.store.segments(id)
      if(prior.length){writeFileSync(join(dir,`partial-transcript-${Date.now()}.json`),JSON.stringify(prior),{mode:0o600});this.d.store.deleteSegments(prior.map(s=>s.id))}
      this.save(j,'transcribing','로컬 음성 모델로 전사하고 있습니다. 완료된 구간은 기록에서 확인할 수 있습니다.')
      const done=await this.d.transcribe(id,{them:ffmpegDecode(join(dir,'them.ogg'),signal)},()=>signal.aborted||this.d.recording())
      if(signal.aborted)throw new Error('전사를 중단했습니다. 완료된 구간은 보존했습니다.')
      if(!done||this.d.store.meeting(id)?.transcriptionPending){this.save(j,'interrupted','전사가 중단됐습니다. 원본과 부분 전사를 보존했습니다. 다시 시작하면 부분 전사를 별도 보관하고 전체를 전사합니다.');return}
      if(!this.d.store.segments(id).some(s=>s.text.trim()))throw new Error('음성은 저장됐지만 인식된 발화가 없습니다. 선택 구간과 오디오를 확인한 뒤 다시 시작하세요.')
    }
    if(signal.aborted)throw new Error('작업을 중단했습니다.')
    saveSource()
    j.durationMs=Math.round(duration)
    this.d.store.updateMeeting(id,{durationMs:j.durationMs,endedAt:(this.d.store.meeting(id)?.startedAt||Date.now())+j.durationMs})
    if(!j.captionFallback)delete j.errorDetail
    this.save(j,'done',transcript?'기존 전사를 가져왔습니다. 기록을 열어 맥락 자료를 넣고 정리를 시작하세요.':j.captionFallback?'자막을 가져오지 못해 로컬 음성 전사를 완료했습니다. 기록을 열어 정리를 시작하세요.':'전사가 끝났습니다. 기록을 열어 맥락 자료를 넣고 정리를 시작하세요.')
    this.d.completed?.(id,j.video)
  }
}
export function hookImports(d:Deps){
  const manager=new ImportManager(d)
  ipcMain.handle('imports:info',(_e,id:unknown)=>importedTranscriptInfo(d.root,id))
  ipcMain.handle('imports:list',()=>manager.list())
  ipcMain.handle('imports:pick',async()=>{const opts={title:'음성·동영상 또는 전사 가져오기',properties:['openFile','multiSelections'] as ('openFile'|'multiSelections')[],filters:[{name:'음성·영상·전사',extensions:[...MEDIA_EXTS,...TRANSCRIPT_EXTS]}]};const w=d.window(),r=w?await dialog.showOpenDialog(w,opts):await dialog.showOpenDialog(opts);return r.canceled?[]:r.filePaths.map(describeFile)})
  ipcMain.handle('imports:describe',(_e,paths:unknown)=>{if(!Array.isArray(paths)||paths.length>2)throw new Error('파일은 음성 1개와 전사 1개까지 넣어 주세요.');return paths.map(describeFile)})
  ipcMain.handle('imports:start',(_e,raw:ImportRequest)=>manager.add(raw))
  ipcMain.handle('imports:cancel',(_e,id:unknown)=>{if(typeof id==='string')manager.cancel(id)})
  ipcMain.handle('imports:retry',(_e,id:unknown)=>{if(typeof id==='string')manager.retry(id)})
  ipcMain.handle('imports:tools',async()=>Promise.all((['ffmpeg','ffprobe','yt-dlp'] as const).map(async name=>{try{return {name,ready:true,version:(await command(mediaTool(name),[name==='yt-dlp'?'--version':'-version'])).split('\n')[0]}}catch{return {name,ready:false,version:'설치본의 미디어 도구를 준비하세요.'}}})))
  const timer=setInterval(()=>manager.kick(),5000);timer.unref();app.on('will-quit',()=>clearInterval(timer));return manager
}
