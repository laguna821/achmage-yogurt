import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Organizer, evidencePacket, parseJson, validateFindings, validateQuestions } from '../src/main/organizer'
import { publicEntity, vaultEvidence, webEvidence } from '../src/main/organizer/evidence'
import type { Evidence, RecordIssue } from '../src/shared/organizer'
import type { Llm, PromptInput } from '../src/main/notes/enhance'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach(p => rmSync(p, {recursive:true,force:true})))
const issue: RecordIssue = {id:'I1',category:'date',question:'날짜는?',context:'다음 주',query:'워크숍 일정'}
const source: PromptInput = {title:'대화',attendees:[],mine:'',language:'Korean',oneMic:true,transcript:'[0:00] [channel=me; label=me] 다음 주에 만납시다.\n[12:30] [channel=me; label=me] 날짜는 아직 미정입니다.'}
const md='## 개요\n\n다음 만남을 논의했다.\n\n## 다음 만남\n\n다음 주에 만나자는 제안이 있었으며 날짜는 미정이다.'

describe('context-first organizer', () => {
  it('bounds source excerpts and never upgrades invented citations into confirmed facts', () => {
    const evidence: Evidence[] = Array.from({length:4},(_,n)=>({id:`V${n}`,provider:'vault',title:'자료',locator:'source',text:'가'.repeat(7000),issueIds:['I1']}))
    expect(JSON.parse(evidencePacket(evidence,10000)).reduce((n:number,e:any)=>n+e.text.length,0)).toBe(10000)
    expect(JSON.parse(evidencePacket(evidence,10000)).map((e:any)=>e.id)).toEqual(['V0','V1','V2','V3'])
    expect(validateFindings([{issueId:'I1',value:'12일',confidence:'confirmed',sourceIds:['invented']}],[issue],evidence)[0].confidence).toBe('unresolved')
    expect(publicEntity('someone@example.com')).toBeUndefined();expect(publicEntity('힉스필드')).toBe('힉스필드')
    expect(()=>parseJson('not JSON')).toThrow('구조')
    expect(validateQuestions([{issueId:'I1',question:'첫 질문'},{issueId:'I1',question:'중복 질문'},{issueId:'invented',question:'없는 항목'}],[issue])).toHaveLength(1)
  })
  it('produces a draft before a batched interview, preserves artifacts and restores answers after restart', async () => {
    const dir=mkdtempSync(join(tmpdir(),'yogurt-organizer-'));dirs.push(dir)
    const app=new Organizer(dir,resolve('resources/achmage-transcript'),()=>{})
    app.configure('meeting',{kind:'conversation',profile:'record',vault:false,mail:false,web:false},{notes:'사전 맥락',participants:'',links:''})
    app.attach('meeting',[{id:'fixture',provider:'attached',title:'원자료',locator:'fixture.txt',text:'독립 자료의 마지막 문장도 검수에 도달한다.',issueIds:[]}])
    let calls=0
    const replies=[{kind:'conversation',seedQuery:'일정',glossary:[],roster:[],issues:[issue]}, {findings:[{issueId:'I1',original:'다음 주',value:'미정',confidence:'unresolved',sourceIds:[],basis:'합의되지 않음'}],speakers:[{label:'me',name:'김 교수',confidence:'confirmed',sourceIds:[],scope:'전체',basis:'추정'}],questions:[]}, md,md,{questions:[{issueId:'I1',question:'날짜를 확정했나요?',options:['미정 유지','날짜 지정'],defaultAnswer:'미정 유지',basis:'발언에서 확정하지 않음'}],notes:[]}]
    const llm:Llm={contextSize:900000,count:async xs=>xs.map(x=>x.length),chat:async(p,t)=>{expect(p).toContain('날짜는 아직 미정입니다.');expect(p).toContain('독립 자료의 마지막 문장도 검수에 도달한다.');const r=replies[calls++];const text=typeof r==='string'?r:JSON.stringify(r);t(text);return text}}
    const streamed:string[]=[]
    const output=await app.run('meeting',source,llm,s=>streamed.push(s),Date.now())
    expect(streamed).toEqual([])
    expect(output).toBe(md);app.complete('meeting',output)
    const state=app.get('meeting');expect(state.phase).toBe('questions');expect(state.speakers[0].confidence).toBe('unresolved')
    const work=join(dir,'meeting',state.runId!,'_work');expect(readFileSync(join(work,'turns.txt'),'utf8')).toContain('날짜는 아직 미정')
    expect(readFileSync(join(work,'speaker-map.json'),'utf8')).not.toContain('김 교수')
    app.answer('meeting',{I1:'1월 12일이다.'})
    const restored=new Organizer(dir,resolve('resources/achmage-transcript'),()=>{}).get('meeting')
    expect(restored.questions[0].answer).toBe('1월 12일이다.');expect(restored.options.kind).toBe('conversation')
    expect(calls).toBe(5)
    expect(state.evidence.filter(e=>e.id==='C1')).toHaveLength(1)
    expect(state.evidence.find(e=>e.id==='C1')?.provider).toBe('user')
    // A resolved question disappears after a rewrite, but its answer remains evidence for later runs.
    const revised = new Organizer(dir,resolve('resources/achmage-transcript'),()=>{})
    const answeredReplies=[replies[0],{findings:[],speakers:[],questions:[]},md,md,{questions:[],notes:[]}]
    let next=0
    const answered:Llm={...llm,chat:async(p,t)=>{expect(p).toContain('1월 12일이다.');const r=answeredReplies[next++];const text=typeof r==='string'?r:JSON.stringify(r);t(text);return text}}
    revised.complete('meeting',await revised.run('meeting',source,answered,()=>{},Date.now()))
    expect(revised.get('meeting').questions).toHaveLength(0)
    expect(revised.get('meeting').evidence.find(e=>e.id==='U1')?.text).toContain('1월 12일이다.')
    next=0
    await revised.run('meeting',source,answered,()=>{},Date.now())
    expect(revised.get('meeting').evidence.filter(e=>e.id==='C1')).toHaveLength(1)
  })
  it.skipIf(!process.env.YOGURT_TEST_LOCAL_MCP)('reads actual vault evidence via the dedicated read-only MCP connection without a model', async()=>{
    const result=await vaultEvidence([issue],'2026-11-18 교수회의 정리')
    expect(result.status.connected).toBe(true);expect(result.evidence.length).toBeGreaterThan(0);expect(result.evidence.some(e=>e.text.includes('2027'))).toBe(true)
  },60000)
  it.skipIf(!process.env.YOGURT_TEST_LOCAL_WEB)('reads a public product spelling with the real web connector without a model', async()=>{
    const result=await webEvidence([{id:'WEB1',category:'term',question:'공식 제품명',context:'',query:'Higgsfield',publicEntity:'Higgsfield'}])
    expect(result.status.connected).toBe(true);expect(result.evidence).toHaveLength(1)
    expect(result.evidence[0].text).toContain('Higgsfield');expect(result.evidence[0].locator).toContain('higgsfield.ai')
  },60000)
})
