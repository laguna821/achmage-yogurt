export type ImportFile = { path: string; name: string; bytes: number; kind: 'media' | 'transcript' }
export type ImportStage = 'queued' | 'copying' | 'downloading' | 'converting' | 'transcribing' | 'waiting' | 'done' | 'failed' | 'cancelled' | 'interrupted'
export const isImportFinished = (stage: ImportStage) => ['done', 'failed', 'cancelled', 'interrupted'].includes(stage)
export type ImportJob = { dismissedAt?: number; video?: import('./video').VideoOptions; id: string; meetingId?: string; title: string; files: ImportFile[]; url?: string; caption?: boolean; captionFallback?: string; errorDetail?: string; transcriptSource?: 'youtube-captions' | 'local-asr'; captionLanguage?: string; captionAutomatic?: boolean; start?: number; end?: number; stage: ImportStage; message: string; createdAt: number; updatedAt: number; durationMs?: number; assets?: { name: string; sha256: string; bytes: number }[] }
export type ImportRequest = { video?: Partial<import('./video').VideoOptions>; paths?: string[]; title?: string; url?: string; caption?: boolean; start?: number; end?: number }
export type ImportedTurn = { text: string; startMs: number; endMs: number; speaker: string | null }
export const MEDIA_EXTS = ['wav','mp3','m4a','flac','ogg','opus','webm','mp4','mov','aac','aiff','mkv']
export const TRANSCRIPT_EXTS = ['txt','md','srt','vtt','json','docx','pdf']
export function youtubeUrl(raw: string): string {
  const u=new URL(raw)
  if(u.protocol!=='https:'||u.username||u.password||!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(u.hostname))throw new Error('YouTube HTTPS 영상 링크를 입력하세요.')
  const id=u.hostname==='youtu.be'?u.pathname.slice(1):u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)$/)?.[1]
  if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id))throw new Error('재생목록이 아닌 개별 영상 링크를 입력하세요.')
  return 'https://www.youtube.com/watch?v='+id
}
function ms(raw:string):number {
  const p=raw.trim().replace(',','.').split(':').map(Number)
  if(p.some(x=>!Number.isFinite(x)||x<0)||p.length<2||p.length>3)throw new Error('전사 시각 형식을 확인하세요.')
  return Math.round((p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+p[1])*1000)
}
export function parseTranscript(raw:string,extension:string):{turns:ImportedTurn[];timed:boolean} {
  const text=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n'),ext=extension.replace(/^\./,'').toLowerCase()
  if(!text.trim())throw new Error('빈 전사 파일입니다.')
  if(ext==='json'){
    const d=JSON.parse(text), list=Array.isArray(d)?d:d.segments
    if(!Array.isArray(list)||!list.length)throw new Error('JSON은 text/start/end 또는 text/startMs/endMs 구간 배열이어야 합니다.')
    const turns:ImportedTurn[]=list.map((r:Record<string,unknown>)=>{
      if(typeof r.text!=='string')throw new Error('JSON 구간의 text를 확인하세요.')
      const startMs=Number(r.startMs??Number(r.start)*1000),endMs=Number(r.endMs??Number(r.end)*1000)
      if(!Number.isFinite(startMs)||!Number.isFinite(endMs)||startMs<0||endMs<startMs)throw new Error('JSON 구간의 시작/종료 시각을 확인하세요.')
      return {text:r.text.trim(),startMs:Math.round(startMs),endMs:Math.round(endMs),speaker:typeof r.speaker==='string'?r.speaker:null}
    }).filter(r=>r.text)
    return {turns,timed:true}
  }
  const lines=text.split('\n'),turns:ImportedTurn[]=[]
  // A space-only payload line is valid WebVTT, not a cue separator.
  const timing=/^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d+)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d+)/
  const wordTime=/<(?:\d+:)?\d{2}:\d{2}\.\d+>/
  const clean=(s:string)=>s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ').trim()
  let previous=new Map<string,boolean>(),previousEnd=-Infinity
  for(let i=0;i<lines.length;i++){
    const time=lines[i].match(timing)
    if(!time)continue
    const body:string[]=[]
    while(i+1<lines.length&&lines[i+1]!==''&&!timing.test(lines[i+1]))body.push(lines[++i])
    const source=body.join('\n'),speaker=source.match(/<v(?:\.[^ >]+)?\s+([^>]+)>/)?.[1]||null
    const startMs=ms(time[1]),endMs=ms(time[2]);if(endMs<startMs)throw new Error('종료 시각이 시작보다 빠른 구간이 있습니다.')
    const current=new Map<string,boolean>(),fresh:string[]=[]
    for(const line of body){
      const value=clean(line);if(!value)continue
      const timed=wordTime.test(line),prior=previous.get((speaker||'')+'\0'+value),adjacent=startMs<=previousEnd+250&&startMs>=previousEnd-1000
      // Only proven rolling display copies are removed. A re-timed repetition is new speech.
      const copy=ext==='vtt'&&!timed&&prior===true&&adjacent
      current.set((speaker||'')+'\0'+value,timed||copy)
      if(!copy)fresh.push(value)
    }
    if(fresh.length)turns.push({text:fresh.join('\n'),startMs,endMs,speaker})
    previous=current;previousEnd=endMs
  }
  if(turns.length)return {turns,timed:true}
  if(ext==='srt'||ext==='vtt')throw new Error('자막에서 유효한 시간 구간을 찾지 못했습니다.')
  const plain=text.split(/\n\s*\n/).filter(s=>s.trim()).map(s=>{const speaker=s.match(/^([^\n:]{1,60}):\s+/);return {text:speaker?s.slice(speaker[0].length):s,startMs:0,endMs:0,speaker:speaker?.[1]||null}})
  return {turns:plain,timed:false}
}
