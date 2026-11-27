import { useCallback, useEffect, useState } from 'react'
import { Download, RefreshCw, Link } from 'lucide-react'
import type { PlaudRecording, PlaudStatus, PlaudImportOptions } from '../../../shared/plaud'
import { Modal } from './Modal'

function usePlaud() {
  const [status,setStatus]=useState<PlaudStatus>(),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const refresh=useCallback(async()=>{try{setStatus(await window.yogurt.plaud.status())}catch(e){setError(String(e))}},[])
  useEffect(()=>{void refresh();const t=setInterval(()=>void refresh(),1500);return()=>clearInterval(t)},[refresh])
  const act=async(connect:boolean)=>{setBusy(true);setError('');try{setStatus(await (connect?window.yogurt.plaud.connect():window.yogurt.plaud.disconnect()))}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  return {status,error,setError,busy,act}
}
function Connection({state}:{state:ReturnType<typeof usePlaud>}) {
  const {status,error,busy,act}=state
  return <div className="plaud-connection">
    <strong>Plaud · {status?.connected?'연결됨':status?.connecting?'로그인 대기':'연결되지 않음'}</strong>
    <p>{status?.message || '연결 상태를 확인하고 있습니다.'}</p>
    <div className="skin-controls"><button data-testid="plaud-connect" className="workspace-button" disabled={busy||status?.connecting||!!status?.downloading} onClick={()=>void act(true)}>{status?.connecting?'브라우저에서 로그인 중…':status?.connected?'다시 로그인':'Plaud 연결'}</button>{(status?.connected||status?.connecting)&&<button className="workspace-button" disabled={busy||!!status?.downloading} onClick={()=>void act(false)}>{status.connecting?'로그인 취소':'이 컴퓨터 연결 해제'}</button>}</div>
    {error&&<p className="import-error" role="alert">{error}</p>}
  </div>
}
export function PlaudConnectionSettings(){
  const state=usePlaud()
  return <div className="settings-group" data-testid="plaud-settings"><div className="settings-row"><div className="settings-row-copy"><Connection state={state}/><p className="settings-description">Plaud 공식 MCP로 기존 전사·화자·정리본을 가져와 Achmage 정리로 이어갑니다. 원음 보관과 로컬 재전사도 선택할 수 있습니다. 로그인 정보는 이 컴퓨터에 보관합니다.</p><p className="settings-description">Plaud의 전사 시간을 사용하지 않으려면 Plaud 앱의 ‘새 녹음 자동 요약’을 꺼 주세요. 이 연결은 Plaud 전사를 시작하지 않습니다.</p></div></div></div>
}
export function PlaudWorkspace({onOpen}:{onOpen:(id:string)=>void}){
  const [open,setOpen]=useState(false)
  return <><button data-testid="import-plaud" onClick={()=>setOpen(true)}><Link size={17}/>Plaud에서 가져오기</button>{open&&<PlaudDialog onClose={()=>setOpen(false)} onOpen={onOpen}/>}</>
}
function PlaudDialog({onClose,onOpen}:{onClose:()=>void;onOpen:(id:string)=>void}){
  const state=usePlaud(),[page,setPage]=useState(1),[rows,setRows]=useState<PlaudRecording[]>([]),[selected,setSelected]=useState(''),[loading,setLoading]=useState(false),[downloading,setDownloading]=useState(false),[message,setMessage]=useState('')
  const [mode,setMode]=useState<PlaudImportOptions['mode']>('transcript'),[keepAudio,setKeepAudio]=useState(false)
  const connected=state.status?.connected
  const load=useCallback(async()=>{setLoading(true);state.setError('');try{setRows(await window.yogurt.plaud.list(page));setSelected('')}catch(e){state.setError(e instanceof Error?e.message:String(e));setRows([])}finally{setLoading(false)}},[page,state.setError])
  useEffect(()=>{if(connected)void load();else setRows([])},[connected,load])
  const start=async()=>{
    if(!selected)return
    setDownloading(true);state.setError('');setMessage(mode==='transcript'?'Plaud 전사와 화자 정보를 가져오고 있습니다…':'Plaud 원음을 가져오고 있습니다…')
    try{
      const job=await window.yogurt.plaud.import(selected,{mode,keepAudio})
      setMessage(mode==='transcript'?'기존 전사를 가져왔습니다. 자료를 확인한 뒤 정리를 시작하세요.':'로컬 전사 대기열에 등록했습니다. 정리는 전사 완료 후 시작하세요.')
      await load()
      if(job.meetingId){if(mode==='transcript')sessionStorage.setItem('organizer-prepare:'+job.meetingId,'1');onClose();onOpen(job.meetingId)}
    }catch(e){setMessage('');state.setError(e instanceof Error?e.message:String(e))}finally{setDownloading(false)}
  }
  const progress=state.status?.downloading
  return <Modal title="Plaud에서 가져오기" description="기존 전사를 가져오면 재전사를 기다리지 않고 맥락 자료를 확인해 정리를 시작할 수 있습니다." onCancel={onClose} busy={downloading} testId="plaud-dialog">
    <div className="import-body plaud-body"><Connection state={state}/>
      {connected&&<><div className="plaud-toolbar"><span>{page}페이지 · 최근 녹음</span><button disabled={loading||downloading} onClick={()=>void load()}><RefreshCw size={15}/>새로고침</button></div>
      <p className="settings-description">목록이 비어 있다면 Plaud 앱에서 Private Cloud Sync가 켜져 있고 기기의 녹음 전송이 끝났는지 확인하세요.</p>
      <div className="plaud-import-options">
        <label>가져오기 방식<select aria-label="Plaud 가져오기 방식" disabled={downloading} value={mode} onChange={e=>setMode(e.target.value as PlaudImportOptions['mode'])}><option value="transcript">기존 Plaud 전사로 정리 (추천)</option><option value="local">원음으로 새로 전사</option></select></label>
        {mode==='transcript'?<><label><input type="checkbox" checked={keepAudio} disabled={downloading} onChange={e=>setKeepAudio(e.target.checked)}/> 원음도 보관하기 · 재생·검증용</label><small>화자·발언 원문과 Plaud 정리본을 가져와 정리 준비 창을 엽니다. 정리본은 대조용 참고 자료로 첨부됩니다. 원음은 백그라운드에서 받으며, AI 정리는 시작 버튼을 누른 뒤 실행합니다.</small></>:<small>이 컴퓨터의 선택된 음성 모델로 처음부터 전사합니다. 긴 녹음은 오래 걸릴 수 있으며 기존 Plaud 전사와 별도 기록으로 저장합니다.</small>}
      </div>
      <div className="plaud-recordings" aria-label="Plaud 녹음 목록" role="radiogroup">{loading?<p role="status">녹음 목록을 불러오고 있습니다…</p>:!rows.length?<p>표시할 녹음이 없습니다.</p>:rows.map(row=><label className="plaud-recording" key={row.id}><input type="radio" name="plaud-recording" checked={selected===row.id} disabled={downloading} onChange={()=>setSelected(row.id)}/><span><strong>{row.name}</strong><small>{row.createdAt && !Number.isNaN(Date.parse(row.createdAt))?new Date(row.createdAt).toLocaleString():row.createdAt} · {Math.round(row.durationMs/60000)}분{row.jobId?' · 가져온 기록':''}</small></span>{row.meetingId&&<button disabled={downloading} onClick={e=>{e.preventDefault();onClose();onOpen(row.meetingId!)}}>기록 열기</button>}</label>)}</div>
      <div className="plaud-toolbar"><button disabled={page===1||loading||downloading} onClick={()=>setPage(p=>p-1)}>이전</button><button disabled={rows.length<20||loading||downloading} onClick={()=>setPage(p=>p+1)}>다음</button></div></>}
      {message&&<p role="status">{message}</p>}{progress&&<p role="status">원음 보관/자료 가져오기 {(progress.bytes/1_000_000).toFixed(1)}MB{progress.total?` / ${(progress.total/1_000_000).toFixed(1)}MB`:''} <button onClick={()=>void window.yogurt.plaud.cancel()}>중단</button></p>}
    </div><div className="modal-actions">{downloading?<button onClick={()=>void window.yogurt.plaud.cancel()}>가져오기 중단</button>:<button data-dialog-cancel onClick={onClose}>닫기</button>}<button className="primary" data-testid="plaud-import-start" disabled={!selected||loading||downloading||!connected} onClick={()=>void start()}><Download size={16}/>{downloading?'자료 가져오는 중…':mode==='transcript'?'가져와서 정리 준비':'가져와서 로컬 전사'}</button></div>
  </Modal>
}
