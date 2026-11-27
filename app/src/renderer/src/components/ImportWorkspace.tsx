import { useRecordActivity } from '../useRecordActivity'
import { PlaudWorkspace } from './PlaudWorkspace'
import { useEffect,useState } from 'react'
import { FileUp,Link,FolderOpen,RefreshCw,X } from 'lucide-react'
import { Modal } from './Modal'
import {defaultVideoOptions,type VideoOptions,type VideoState} from '../../../shared/video'
import {VideoOptionsFields} from './VideoWorkspace'
import { isImportFinished, type ImportFile, type ImportJob } from '../../../shared/imports'

export function ImportWorkspace({onOpen}:{onOpen:(id:string)=>void}){
  const recordActivity=useRecordActivity()
  const activeCount=[...recordActivity.values()].filter(a=>a.state==='active'||a.state==='waiting').length
  const [open,setOpen]=useState(false),[tab,setTab]=useState<'file'|'url'>('file'),[files,setFiles]=useState<ImportFile[]>([]),[jobs,setJobs]=useState<ImportJob[]>([])
  const [url,setUrl]=useState(''),[title,setTitle]=useState(''),[caption,setCaption]=useState(true),[start,setStart]=useState(''),[end,setEnd]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [video,setVideo]=useState<VideoOptions>({...defaultVideoOptions}),[model,setModel]=useState('')
  const [videoJobs,setVideoJobs]=useState<VideoState[]>([])
  const [tools,setTools]=useState<{name:string;ready:boolean;version:string}[]>([])
  useEffect(()=>{void window.yogurt.imports.list().then(setJobs);return window.yogurt.imports.onChange(setJobs)},[])
  useEffect(()=>{let current=true;void Promise.all(jobs.filter(j=>j.url&&j.meetingId&&j.stage==='done').slice(0,10).map(j=>window.yogurt.video.get(j.meetingId!).catch(()=>undefined))).then(states=>{if(current)setVideoJobs(previous=>{const merged=new Map(previous.map(s=>[s.meetingId,s]));for(const state of states)if(state&&(!merged.has(state.meetingId)||merged.get(state.meetingId)!.updatedAt<=state.updatedAt))merged.set(state.meetingId,state);return [...merged.values()]})});return()=>{current=false}},[jobs])
  useEffect(()=>window.yogurt.video.onChange(state=>setVideoJobs(previous=>[state,...previous.filter(s=>s.meetingId!==state.meetingId)])),[])
  useEffect(()=>{if(open){void window.yogurt.imports.tools().then(setTools);void window.yogurt.subscription.status().then(s=>setModel(`${s.model} · ${s.effort}`)).catch(()=>{})}},[open])
  const choose=async()=>{try{setFiles(await window.yogurt.imports.pick());setError('')}catch(e){setError(String(e))}}
  const drop=async(list:FileList)=>{try{setFiles(await window.yogurt.imports.describe(Array.from(list).map(file=>window.yogurt.imports.filePath(file))));setError('')}catch(e){setError(String(e))}}
  const add=async()=>{setBusy(true);try{await window.yogurt.imports.start(tab==='url'?{url,title,caption,video,start:Number(start),end:end?Number(end):undefined}:{paths:files.map(f=>f.path),title});setFiles([]);setError('');setOpen(false)}catch(e){setError(String(e))}finally{setBusy(false)}}
  const visibleJobs=jobs.filter(j=>!j.dismissedAt)
  const pendingJobs=visibleJobs.filter(j=>(j.stage!=='done'||j.audioStatus==='pending'||j.audioStatus==='failed'))
  const recent=pendingJobs.filter(j=>!j.meetingId||isImportFinished(j.stage)&&j.stage!=='done').slice(0,3)
  const dismiss=async(id?:string)=>{try{if(id)await window.yogurt.imports.dismiss(id);else await window.yogurt.imports.dismissFinished();setError('')}catch(e){setError(String(e))}}
  const researchStatus=(s:VideoState)=>s.research.find(r=>['queued','searching','writing'].includes(r.phase))?.message
  const organizing=videoJobs.filter(s=>['failed','interrupted'].includes(s.phase)).slice(0,3)
  return <>
    <div className="import-actions"><button data-testid="import-files" onClick={()=>{setTab('file');setOpen(true)}}><FileUp size={17}/>음성·전사 가져오기</button><button data-testid="import-link" onClick={()=>{setTab('url');setOpen(true)}}><Link size={17}/>YouTube 정리</button><PlaudWorkspace onOpen={onOpen}/><button onClick={()=>setOpen(true)}>가져오기 작업 {pendingJobs.length>0&&`· ${pendingJobs.length}`}</button></div>
    {activeCount>0&&<p className="library-work-count" role="status">{activeCount}개 기록 처리 중 · 각 기록에서 진행 상태를 확인하세요.</p>}
    {recent.length>0&&<div className="import-progress" role="status">{recent.map(j=><div key={j.id} data-stage={j.stage} data-job-id={j.id}><strong>{j.title}</strong><span>{j.message}{j.audioMessage&&<> · {j.audioMessage}</>}</span>{['failed','interrupted'].includes(j.stage)&&<button onClick={()=>void window.yogurt.imports.retry(j.id)}>다시 시작</button>}{j.meetingId&&<button onClick={()=>onOpen(j.meetingId!)}>기록 열기</button>}{isImportFinished(j.stage)&&<button aria-label={j.title+' 알림 닫기'} title="알림만 닫습니다. 원본과 정리 문서는 보존됩니다." onClick={()=>void dismiss(j.id)}><X size={14}/>알림 닫기</button>}</div>)}</div>}
    {organizing.length>0&&<div className="import-progress video-import-progress" data-testid="video-import-progress" role="status">{organizing.map(s=><div key={s.meetingId} data-stage={s.phase}><strong>영상 정리 · {s.metadata.title}</strong><span>{researchStatus(s)||s.message}</span><button onClick={()=>onOpen(s.meetingId)}>진행·결과 열기</button></div>)}</div>}
    {!open&&error&&<p role="alert" className="import-error">{error}</p>}
    {open&&<Modal title="외부 음성과 전사 가져오기" description="음성 원본, 기존 전사 또는 둘 다 가져온 뒤 맥락 자료를 넣고 정리할 수 있습니다." onCancel={()=>setOpen(false)} testId="import-dialog" busy={busy}>
      <div className="import-body"><div className="skin-controls"><button aria-pressed={tab==='file'} onClick={()=>setTab('file')}>파일</button><button aria-pressed={tab==='url'} onClick={()=>setTab('url')}>YouTube</button></div>
      {tab==='file'?<div className="import-drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();void drop(e.dataTransfer.files)}}>
        <FileUp size={28}/><strong>음성·동영상 또는 전사 파일을 놓으세요</strong><p>음성 1개와 전사 1개를 함께 넣으면 한 기록으로 연결합니다.</p><button onClick={()=>void choose()}>파일 선택</button>
        <ul>{files.map(f=><li key={f.path}>{f.kind==='media'?'음성·영상':'전사'} · {f.name} · {(f.bytes/1_000_000).toFixed(1)}MB</li>)}</ul>
        <small>음성: WAV·MP3·M4A·FLAC·OGG·WebM 등 / 전사: TXT·MD·SRT·VTT·구간 JSON·DOCX·PDF</small>
      </div>:<div className="import-fields"><label>YouTube 영상 링크<input data-dialog-focus aria-label="YouTube 영상 링크" placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={e=>setUrl(e.target.value)}/></label>
        <label>처리 방식<select value={caption?'caption':'audio'} onChange={e=>setCaption(e.target.value==='caption')}><option value="audio">오디오를 받아 로컬 모델로 전사</option><option value="caption">자막 우선 · 실패하면 로컬 음성 전사</option></select></label>
        <div className="import-range"><label>시작 지점(초)<input type="number" min="0" value={start} onChange={e=>setStart(e.target.value)} placeholder="0"/></label><label>종료 지점(초)<input type="number" min="0" value={end} onChange={e=>setEnd(e.target.value)} placeholder="영상 끝까지"/></label></div><small>공개된 개별 영상을 지원합니다. 자막은 한 개만 요청합니다. 없거나 요청이 제한되면 오디오를 받아 로컬 전사로 이어갑니다.</small><VideoOptionsFields value={video} onChange={setVideo}/><p>사용할 AI: {model||'설정된 구독 모델'}</p></div>}
      <label className="import-title">기록 제목(선택)<input aria-label="가져올 기록 제목" value={title} onChange={e=>setTitle(e.target.value)} placeholder="원래 파일명 또는 영상 제목 사용"/></label>
      <details><summary>미디어 도구 상태</summary>{tools.map(t=><p key={t.name}>{t.ready?'✓':'!'} {t.name}: {t.version}</p>)}</details>
      {error&&<p role="alert" className="import-error">{error}</p>}
      <div className="import-job-list"><div className="import-job-heading"><h3>가져오기 작업</h3>{visibleJobs.some(j=>isImportFinished(j.stage))&&<button onClick={()=>void dismiss()}>끝난 작업 내역 지우기</button>}</div><small>내역을 지워도 녹음·전사·정리 문서는 보존됩니다.</small>{!visibleJobs.length&&<p>표시할 작업 내역이 없습니다.</p>}{visibleJobs.map(j=><article key={j.id} data-job-id={j.id}><strong>{j.title}</strong><p>{j.message}</p>{j.audioMessage&&<p>{j.audioMessage}</p>}{j.captionFallback&&<small>{j.captionFallback}</small>}{j.errorDetail&&<details><summary>기술 정보</summary><pre className="import-error">{j.errorDetail}</pre></details>}<div>{j.meetingId&&<button onClick={()=>{setOpen(false);onOpen(j.meetingId!)}}><FolderOpen size={14}/>기록 열기</button>}{['failed','cancelled','interrupted'].includes(j.stage)&&<button onClick={()=>void window.yogurt.imports.retry(j.id)}><RefreshCw size={14}/>다시 시작</button>}{!['done','failed','cancelled','interrupted'].includes(j.stage)&&<button onClick={()=>void window.yogurt.imports.cancel(j.id)}><X size={14}/>중단</button>}{isImportFinished(j.stage)&&<button onClick={()=>void dismiss(j.id)}><X size={14}/>내역 지우기</button>}</div></article>)}</div>
      </div><div className="modal-actions"><button data-dialog-cancel onClick={()=>setOpen(false)}>닫기</button><button data-testid="import-start" className="primary" disabled={busy||(tab==='file'?!files.length:!url.trim())} onClick={()=>void add()}>{busy?'등록 중…':tab==='url'&&video.depth!=='transcript'?'이 영상 정리하기':'가져오기 시작'}</button></div>
    </Modal>}
  </>
}
