import {describe,it,expect,afterEach,vi}from'vitest'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync}from'node:fs'
import {tmpdir}from'node:os'
import {join}from'node:path'
import {parseTranscript,youtubeUrl}from'../src/shared/imports'
import {Store}from'../src/main/store'
import {migrateLegacyProfile}from'../src/main/profileMigration'
vi.mock('electron',()=>({app:{on:vi.fn()},BrowserWindow:class{},dialog:{},ipcMain:{handle:vi.fn()}}))
import {ImportManager}from'../src/main/imports'
import {importMaterial}from'../src/main/organizer/runtime'
import {hookNoteVersions}from'../src/main/noteVersions'
import {ipcMain}from'electron'
import {ZipFile}from'yazl'
import{createWriteStream}from'node:fs'
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true})})
const temp=()=>{const d=mkdtempSync(join(tmpdir(),'achmage-import-'));dirs.push(d);return d}
describe('external input fidelity',()=>{
  it('keeps subtitle timing, Unicode, voices and does not invent plain-text timestamps',()=>{
    const v=parseTranscript('WEBVTT\n\n00:01.200 --> 00:03.400\n<v 김교수>한국어와 English 용어\n\n','vtt')
    expect(v).toEqual({timed:true,turns:[{startMs:1200,endMs:3400,speaker:'김교수',text:'한국어와 English 용어'}]})
    expect(parseTranscript('1\n00:00:02,300 --> 00:00:04,100\n수업 내용\n','srt').turns[0].startMs).toBe(2300)
    expect(parseTranscript('김교수: 기존 발언\n\n다음 문단','txt')).toEqual({timed:false,turns:[{text:'기존 발언',speaker:'김교수',startMs:0,endMs:0},{text:'다음 문단',speaker:null,startMs:0,endMs:0}]})
    expect(()=>parseTranscript('not a cue','srt')).toThrow()
    expect(()=>parseTranscript('[{"text":"x","start":4,"end":2}]','json')).toThrow()
  })
  it('accepts only one public-video identifier, never arbitrary URLs or playlist-only input',()=>{
    expect(youtubeUrl('https://youtu.be/abcdefghijk?t=50')).toBe('https://www.youtube.com/watch?v=abcdefghijk')
    for(const url of ['http://youtube.com/watch?v=abcdefghijk','https://youtube.com.evil.test/watch?v=abcdefghijk','https://www.youtube.com/playlist?list=ABC','file:///etc/passwd'])expect(()=>youtubeUrl(url)).toThrow()
  })
  it('imports an existing transcript without ASR or AI and retains its original bytes',async()=>{
    const root=temp(),file=join(root,'lecture.srt'),raw='1\n00:00:01,000 --> 00:00:03,000\n한국어 English\n';writeFileSync(file,raw)
    const store=new Store(join(root,'test.db')),transcribe=vi.fn(),manager=new ImportManager({root,store,window:()=>undefined,changed:()=>{},available:()=>false,recording:()=>false,transcribe})
    const job=manager.add({paths:[file]})
    await vi.waitFor(()=>expect(manager.list()[0].stage).toBe('done'))
    const done=manager.list()[0];expect(store.segments(done.meetingId!)).toHaveLength(1);expect(store.segments(done.meetingId!)[0].startMs).toBe(1000)
    expect(readFileSync(join(root,'meetings',done.meetingId!,'original','0-lecture.srt'),'utf8')).toBe(raw);expect(transcribe).not.toHaveBeenCalled()
    manager.retry(job.id);await new Promise(r=>setTimeout(r,20));expect(store.segments(done.meetingId!)).toHaveLength(1);store.close()
  })
  it('creates a consistent independent profile and leaves the original database unchanged',async()=>{
    const legacy=temp(),dest=temp(),store=new Store(join(legacy,'yogurt.db'))
    const m=store.createMeeting({title:'보존할 회의',startedAt:100,endedAt:1000,state:'stopped',eventId:null,app:null,attendees:[]});store.setNotes(m.id,{enhanced:'# 기존 문서\n\n원문',edited:true});writeFileSync(join(legacy,'settings.json'),'{"aiModel":"gpt-6.2-sol"}')
    await migrateLegacyProfile(legacy,dest)
    const migrated=new Store(join(dest,'yogurt.db'));expect(migrated.notes(m.id).enhanced).toBe('# 기존 문서\n\n원문');expect(store.notes(m.id).enhanced).toBe('# 기존 문서\n\n원문');expect(existsSync(join(dest,'migration.json'))).toBe(true);migrated.close();store.close()
  })
})
describe('document import and version fidelity',()=>{
  it('extracts PDF, Word and email text with no external service',async()=>{
    const root=temp(),docx=join(root,'context.docx'),zip=new ZipFile()
    zip.addBuffer(Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),'[Content_Types].xml')
    zip.addBuffer(Buffer.from('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>한국어 lecture context</w:t></w:r></w:p></w:body></w:document>'),'word/document.xml');const out=createWriteStream(docx);zip.outputStream.pipe(out);zip.end();await new Promise<void>(r=>out.on('close',r))
    expect((await importMaterial(docx,'word')).text).toContain('한국어 lecture context')
    const eml=join(root,'context.eml');writeFileSync(eml,'From: professor@example.test\r\nSubject: Seminar context\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n한국어와 English 단어\r\n')
    expect((await importMaterial(eml,'email')).text).toContain('한국어와 English 단어')
    const pdf=join(root,'context.pdf'),parts=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length 56 >>\nstream\nBT /F1 14 Tf 50 700 Td (Lecture context English) Tj ET\nendstream']
    let bytes='%PDF-1.4\n';const offsets=[0];for(let n=0;n<parts.length;n++){offsets.push(bytes.length);bytes+=(n+1)+' 0 obj\n'+parts[n]+'\nendobj\n'}const xref=bytes.length;bytes+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer << /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';writeFileSync(pdf,bytes)
    expect((await importMaterial(pdf,'pdf')).text).toContain('Lecture context English')
  })
  it('keeps the current document until a candidate is applied and checks restore conflicts',()=>{
    const store=new Store(join(temp(),'versions.db')),m=store.createMeeting({title:'버전',startedAt:1,endedAt:2,state:'stopped',eventId:null,app:null,attendees:[]})
    const hooks=hookNoteVersions(store,()=>{}),handler=(name:string)=>(ipcMain.handle as any).mock.calls.findLast((c:any)=>c[0]===name)[1]
    store.setNotes(m.id,{enhanced:'# 기존 정리본',edited:true});hooks.propose(m.id,'# 새 후보')
    expect(store.notes(m.id).enhanced).toBe('# 기존 정리본');expect(hooks.candidate(m.id)).toBe('# 새 후보')
    expect(()=>handler('versions:accept')(null,m.id,'오래된 후보')).toThrow();expect(handler('versions:accept')(null,m.id,'# 새 후보')).toBe(true)
    const previous=handler('versions:list')(null,m.id).find((r:any)=>handler('versions:read')(null,m.id,r.id).text==='# 기존 정리본')
    expect(()=>handler('versions:restore')(null,m.id,previous.id,'다른 현재문서')).toThrow();expect(handler('versions:restore')(null,m.id,previous.id,'# 새 후보')).toBe(true);expect(store.notes(m.id).enhanced).toBe('# 기존 정리본');store.close()
  })
})
