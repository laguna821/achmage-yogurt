import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Store} from '../src/main/store'
const {handlers}=vi.hoisted(()=>({handlers:new Map<string,Function>()}))
vi.mock('electron',()=>({app:{},clipboard:{},ClipboardItem:class{},dialog:{},ipcMain:{handle:(name:string,fn:Function)=>handlers.set(name,fn)},protocol:{handle:vi.fn()}}))
vi.mock('../src/main/video/research',()=>({investigate:vi.fn(async(run:any,_original:string,_llm:any,_signal:any,save:Function)=>{run.phase='ready';run.markdown='조사 결과';save()})}))
import {createVideoHost} from '../src/main/video/ipc'
import {investigate} from '../src/main/video/research'
import {VideoWorkspace} from '../src/main/video'
const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});handlers.clear();vi.clearAllMocks()})
function fixture(busy=false){
 const root=mkdtempSync(join(tmpdir(),'video-host-'));roots.push(root);const store=new Store(join(root,'test.db'));stores.push(store)
 const m=store.createMeeting({title:'강의',startedAt:1,endedAt:2,state:'stopped',eventId:null,app:null,attendees:[]}),dir=join(root,'meetings',m.id);mkdirSync(join(dir,'original'),{recursive:true})
 writeFileSync(join(dir,'import-source.json'),JSON.stringify({url:'https://www.youtube.com/watch?v=abcdefghijk',transcriptSource:'local-asr'}));writeFileSync(join(dir,'original/youtube.info.json'),JSON.stringify({title:'강의',duration:60}))
 store.addSegments([{meetingId:m.id,track:'them',speaker:null,startMs:0,endMs:1000,text:'상관과 인과를 구별한다.'},{meetingId:m.id,track:'them',speaker:null,startMs:1000,endMs:2000,text:'관계없는 다른 주제'}])
 const jobs:{run:(signal:AbortSignal)=>Promise<void>;resolve:()=>void}[]=[],llm=vi.fn(async()=>({})),propose=vi.fn()
 const queue={enqueue:(run:any)=>new Promise<void>(resolve=>jobs.push({run,resolve}))} as any
 const host=createVideoHost({root,store,queue,model:{llm} as any,modelKey:()=> 'gpt-test',propose,changed:()=>{},notesChanged:()=>{},busy:()=>busy})
 const s=host.workspace.get(m.id)!;s.phase='ready';s.options.notes='개인 비공개 메일 맥락';s.document={keyPoints:[],topics:[{id:'one',title:'상관과 인과',paragraphs:[{text:'공개 주제',refs:['T1']}],frameIds:[]},{id:'two',title:'별개 주제',paragraphs:[{text:'관계없는 내용',refs:['T2']}],frameIds:[]}],questions:[]};host.workspace.save(s)
 return{root,store,m,host,jobs,llm,propose}
}
it('rejects a busy start without leaving a permanently queued video',()=>{
 const f=fixture(true);expect(()=>f.host.start(f.m.id)).toThrow('진행 중');expect(f.host.workspace.get(f.m.id)?.phase).toBe('ready');expect(f.jobs).toHaveLength(0)
})
it('cancels queued research before any model call and preserves the ready video',async()=>{
 const f=fixture();handlers.get('video:research')!({},f.m.id,'상관과 인과');expect(f.jobs).toHaveLength(1)
 handlers.get('video:cancel')!({},f.m.id);expect(f.host.workspace.get(f.m.id)?.phase).toBe('ready');expect(f.host.workspace.get(f.m.id)?.research[0].phase).toBe('cancelled')
 await f.jobs[0].run(new AbortController().signal);f.jobs[0].resolve();expect(f.llm).not.toHaveBeenCalled()
})
it('limits research context to selected public turns and resumes stored receipts after restart',async()=>{
 const f=fixture();handlers.get('video:research')!({},f.m.id,'상관과 인과');await f.jobs[0].run(new AbortController().signal);f.jobs[0].resolve()
 const original=vi.mocked(investigate).mock.calls[0][1];expect(original).toContain('상관과 인과를 구별한다');expect(original).not.toContain('개인 비공개 메일');expect(original).not.toContain('관계없는 다른 주제')
 const state=f.host.workspace.get(f.m.id)!;const run=state.research[0];run.phase='searching';run.sources=[{id:'R1',title:'read',url:'https://example.org/paper',accessedAt:'2026-11-24',text:'본문',sha256:'hash'}];f.host.workspace.save(state)
 const restarted=new VideoWorkspace({root:f.root,store:f.store,changed:()=>{},modelKey:()=> 'gpt-test'});expect(restarted.get(f.m.id)?.research[0].phase).toBe('failed');expect(restarted.newResearch(f.m.id,'상관과 인과')).toBe(run.id);expect(restarted.get(f.m.id)?.research[0].sources).toHaveLength(1)
})
