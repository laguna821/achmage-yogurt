import {useEffect,useState}from'react'
import {Modal}from'./Modal'
import {Editor}from'./Editor'

export function NoteVersions({id,current,beforeUse,onApplied}:{id:string;current:string;beforeUse:()=>Promise<boolean>;onApplied:()=>void}){
  const [open,setOpen]=useState(false),[candidate,setCandidate]=useState<string>(),[versions,setVersions]=useState<{id:string;side:string;reason:string;createdAt:number;chars:number}[]>([]),[selected,setSelected]=useState<string>(),[selectedId,setSelectedId]=useState(''),[error,setError]=useState('')
  const refresh=()=>{void window.yogurt.versions.candidate(id).then(setCandidate);void window.yogurt.versions.list(id).then(setVersions)}
  useEffect(()=>{refresh();return window.yogurt.notes.onChange(n=>{if(n.meetingId===id)refresh()})},[id])
  return <div className="note-version-controls"><button onClick={()=>{refresh();setSelected(undefined);setSelectedId('');setOpen(true)}}>{candidate!==undefined?'새 정리본 비교·적용':'문서 버전'}</button>{candidate!==undefined&&<span>새 정리본을 보관했습니다. 현재 문서는 유지됩니다.</span>}
    {open&&<Modal title="문서 버전과 새 정리본" onCancel={()=>setOpen(false)} testId="versions-dialog"><div className="versions-body"><label>이전 버전<select value={selectedId} onChange={async e=>{setSelectedId(e.target.value);setSelected(undefined);if(e.target.value){const v=await window.yogurt.versions.read(id,e.target.value);setSelected(v?.text||'')}}}><option value="">새 후보 또는 현재 문서</option>{versions.filter(v=>v.side==='enhanced').map(v=><option key={v.id} value={v.id}>{new Date(v.createdAt).toLocaleString()} · {v.side==='mine'?'내 메모':'정리본'} · {v.reason} · {v.chars}자</option>)}</select></label>
      <div className="versions-compare"><section><h3>현재 문서</h3><Editor meetingId={id} markdown={current} label="현재 문서" testId="version-current" editable={false}/></section><section><h3>{selected?'이전 버전':candidate!==undefined?'새 정리본 후보':'현재 문서'}</h3><Editor meetingId={id} markdown={selected??candidate??current} label="비교할 버전" testId="version-candidate" editable={false}/></section></div>{error&&<p role="alert">{error}</p>}</div>
      <div className="modal-actions"><button onClick={()=>setOpen(false)}>닫기</button>{selectedId&&<button className="primary" onClick={async()=>{try{if(!await beforeUse())return;await window.yogurt.versions.restore(id,selectedId,current);setOpen(false);onApplied()}catch(e){setError(String(e))}}}>이 버전으로 복원</button>}{candidate!==undefined&&!selected&&<button className="primary" onClick={async()=>{try{if(!await beforeUse())return;await window.yogurt.versions.accept(id,candidate);setOpen(false);onApplied()}catch(e){setError(String(e))}}}>새 정리본 적용</button>}</div></Modal>}
  </div>
}
