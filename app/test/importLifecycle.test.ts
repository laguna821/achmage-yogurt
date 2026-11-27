import { it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
vi.mock('electron',()=>({app:{on:vi.fn()},BrowserWindow:class{},dialog:{},ipcMain:{handle:vi.fn()}}))
vi.mock('../src/main/imports/tools',()=>({mediaTool:(name:string)=>name,command:vi.fn(async(name:string,args:string[])=>{if(name==='ffmpeg')writeFileSync(args.at(-1)!,'audio');return '1'}),ffmpegDecode:async function*(){yield new Float32Array(1)}}))
import { ImportManager } from '../src/main/imports'
import { Store } from '../src/main/store'
const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{stores.splice(0).forEach(s=>s.close());roots.splice(0).forEach(r=>rmSync(r,{recursive:true,force:true}))})
function setup(transcribe:any=vi.fn(),recording=()=>false){const root=mkdtempSync(join(tmpdir(),'achmage-lifecycle-'));roots.push(root);const store=new Store(join(root,'db'));stores.push(store);const manager=new ImportManager({root,store,window:()=>undefined,changed:()=>{},available:()=>true,recording,transcribe});return {root,store,manager}}
it('dismisses a cancelled job while its ASR is still unwinding, and never resurrects the alert',async()=>{
 let finish!:(done:boolean)=>void
 const {root,manager,store}=setup(vi.fn(()=>new Promise<boolean>(r=>finish=r)))
 const path=join(root,'audio.mp3');writeFileSync(path,'audio')
 const job=manager.add({paths:[path]});await vi.waitFor(()=>expect(manager.list()[0].stage).toBe('transcribing'))
 manager.cancel(job.id);expect(manager.running).toBe(true);expect(()=>manager.dismiss(job.id)).not.toThrow()
 const id=manager.list()[0].meetingId!;store.trashMeeting(id);manager.cancelMeeting(id)
 expect(manager.list()[0].dismissedAt).toBeTypeOf('number');manager.retry(job.id);expect(manager.list()[0].stage).toBe('cancelled')
 finish(false);await manager.settleMeeting(id);await vi.waitFor(()=>expect(manager.running).toBe(false))
 expect(manager.list()[0]).toMatchObject({stage:'cancelled',dismissedAt:expect.any(Number)})
 const reopened=new ImportManager({root,store,window:()=>undefined,changed:()=>{},available:()=>true,recording:()=>false,transcribe:vi.fn()})
 expect(reopened.list()[0].dismissedAt).toBeTypeOf('number')
})
it('imports provided text immediately even while ASR is busy and preserves its original date and speaker',async()=>{
 let finish!:(done:boolean)=>void
 const asr=vi.fn(()=>new Promise<boolean>(r=>finish=r)),{root,manager,store}=setup(asr)
 const audio=join(root,'audio.mp3');writeFileSync(audio,'audio');manager.add({paths:[audio]})
 await vi.waitFor(()=>expect(manager.list()[0].stage).toBe('transcribing'))
 const path=join(root,'raw.json'),raw=JSON.stringify([{text:'한국어 English 발언',startMs:110,endMs:22750,speaker:'교수 A'}]);writeFileSync(path,raw)
 const job=await manager.provideTranscript({paths:[path],title:'Plaud 회의',externalSource:{provider:'plaud',id:'r1'}},123456)
 expect(job.stage).toBe('done');expect(asr).toHaveBeenCalledTimes(1)
 expect(store.meeting(job.meetingId!)!.startedAt).toBe(123456);expect(store.segments(job.meetingId!)[0]).toMatchObject({speaker:'교수 A',startMs:110})
 expect(readFileSync(join(root,'meetings',job.meetingId!,'original','0-raw.json'),'utf8')).toBe(raw)
 const running=manager.list().find(j=>j.stage==='transcribing')!;manager.cancel(running.id);finish(false);await manager.settleMeeting(running.meetingId!)
})
it('hides historical notifications for records already deleted before the fix',async()=>{
 const {root,manager,store}=setup(),path=join(root,'raw.txt');writeFileSync(path,'원문')
 const job=await manager.provideTranscript({paths:[path]});store.deleteMeeting(job.meetingId!)
 const reopened=new ImportManager({root,store,window:()=>undefined,changed:()=>{},available:()=>false,recording:()=>false,transcribe:vi.fn()})
 expect(reopened.list()[0].dismissedAt).toBeTypeOf('number');expect(reopened.usable(job)).toBe(false)
})

it('retains a resumed recording playback when Plaud audio arrives later',async()=>{
 const {root,manager,store}=setup(),path=join(root,'raw.txt');writeFileSync(path,'원문')
 const job=await manager.provideTranscript({paths:[path]}),dir=join(root,'meetings',job.meetingId!)
 writeFileSync(join(dir,'them.ogg'),'resumed recording')
 const audio=join(root,'plaud.mp3');writeFileSync(audio,'Plaud original')
 await manager.attachAudio(job.id,audio,new AbortController().signal)
 expect(readFileSync(join(dir,'them.ogg'),'utf8')).toBe('resumed recording')
 expect(readFileSync(join(dir,'original','plaud-plaud.mp3'),'utf8')).toBe('Plaud original')
 expect(store.segments(job.meetingId!)[0].text).toBe('원문')
})
