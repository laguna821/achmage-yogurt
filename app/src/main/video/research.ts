import type { Llm } from '../notes/enhance'
import { localMcpConfigs, ReadOnlyMcp, mcpText } from '../organizer/mcpClient'
import { assertPublicUrl, publicText, webPlain } from '../organizer/publicWeb'
import type { ResearchSource, VideoResearch } from '../../shared/video'
import { DATA, hash, json } from './document'
export function searchUrls(text: string): string[] {
  const all: string[] = []
  for (const match of text.matchAll(/(?:href=["']([^"']+)["'])|(https?:\/\/[^\s<>"'\])]+)/g)) {
    try {
      let u = new URL((match[1] || match[2]).replace(/&amp;/g, '&'), 'https://duckduckgo.com')
      if (u.searchParams.get('uddg')) u = new URL(u.searchParams.get('uddg')!)
      if (['http:', 'https:'].includes(u.protocol) && !u.username && !u.password && !/(^|\.)duckduckgo\.com$/i.test(u.hostname)) { u.hash = ''; all.push(u.href) }
    } catch { /* Invalid result links are not evidence. */ }
  }
  return [...new Set(all)]
}
export async function searchPublic(query: string, signal: AbortSignal): Promise<string[]> {
  const config = localMcpConfigs().lightpanda
  if (config) {
    const client = new ReadOnlyMcp(config, new Set(['search']), signal)
    try { return searchUrls(mcpText(await client.call('search', { query }))) } finally { client.close() }
  }
  return searchUrls(await publicText('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), signal))
}
export async function readPublicSource(url: string, id: string, signal: AbortSignal): Promise<ResearchSource> {
  await assertPublicUrl(url)
  const readable=(text:string)=>text.length>=200&&!/access denied|sign in to continue|checking your browser|captcha|checking your connection/i.test(text.slice(0,1000))
  let html='',text='',title=''
  try{html=await publicText(url,signal);text=webPlain(html)}catch(e){if(signal.aborted)throw e}
  if(!readable(text)){
    const config=localMcpConfigs().lightpanda
    if(config){const client=new ReadOnlyMcp(config,new Set(['markdown']),signal);try{text=mcpText(await client.call('markdown',{url,maxBytes:30000}));title=text.match(/^#\s+(.+)/m)?.[1]||''}finally{client.close()}}
    if(!readable(text))throw new Error('원문 확인 불가')
  }else title=webPlain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')
  title=(title||new URL(url).hostname).slice(0,400)
  const publishedAt = html.match(/(?:article:published_time|datePublished)["'][^>]*content=["']([^"']+)/i)?.[1]
  return { id, title, url, publishedAt, text: text.slice(0, 24000), sha256: hash(text), accessedAt: new Date().toISOString() }
}
export type ResearchDeps = { search?: typeof searchPublic; read?: typeof readPublicSource }
export async function investigate(run: VideoResearch, original: string, llm: Llm, signal: AbortSignal, save: () => void, deps: ResearchDeps = {}): Promise<void> {
  const deadline = AbortSignal.timeout(300000), stop = AbortSignal.any([signal, deadline])
  try {
    run.phase = 'searching'; run.message = '조사 질문을 정하고 공개 원문을 찾고 있습니다.'; save()
    if(!run.queries.length){const plan = json(await llm.chat(`${DATA}\nPlan a focused investigation of the user-selected topic, not the entire recording. Korean queries plus original language if useful. Include supporting primary research and a counterargument/limitations query. Return JSON {queries:string[]} with 2-6 public search queries only. Do not include private personal context.\nTOPIC:${JSON.stringify(run.topic)}\nORIGINAL VIDEO CLAIM:${JSON.stringify(original.slice(0, 18000))}`, () => {}, { maxTokens: 1600 }))
    run.queries = [...new Set<string>((Array.isArray(plan.queries) ? plan.queries : []).filter((s: unknown): s is string => typeof s === 'string').map((s: string) => s.slice(0, 220)))].slice(0, 6); save()}
    if (!run.queries.length) throw new Error('조사 질문을 만들지 못했습니다.')
    const visited = new Set<string>(run.sources.map(s=>s.url)), errors: string[] = [], resultSets:string[][]=[]
    // Search every independent question before spending the reading budget. Early definition
    // queries must not consume all eight receipts and crowd out counterevidence/limitations.
    for (const [index,query] of run.queries.entries()) {
      if (stop.aborted||run.sources.length>=8) break
      run.message=`공개 자료 검색 ${index+1}/${run.queries.length} · 질문별 근거를 모으고 있습니다.`;save()
      try {resultSets.push((await (deps.search || searchPublic)(query,stop)).slice(0,5))}
      catch {errors.push('검색 결과를 읽지 못했습니다.');resultSets.push([])}
    }
    for(let round=0;round<5&&run.sources.length<8&&!stop.aborted;round++)for(const urls of resultSets){
      const url=urls[round];if(!url||visited.has(url)||run.sources.length>=8||stop.aborted)continue
      visited.add(url)
      try{run.sources.push(await(deps.read||readPublicSource)(url,`R${run.sources.length+1}`,stop));run.message=`공개 원문 ${run.sources.length}건을 읽었습니다.`;save()}
      catch{errors.push('원문 읽기 실패: '+new URL(url).hostname)}
    }
    if (signal.aborted) throw new Error('조사를 중단했습니다.')
    if (!run.sources.length) throw new Error('읽을 수 있는 공개 원문을 찾지 못했습니다. 검색 연결이나 참고 링크를 확인하세요.')
    run.phase = 'writing'; run.message = '읽은 원문의 지지 근거·반론·한계를 정리하고 있습니다.'; save()
    const result = json(await llm.chat(`${DATA}\nWrite a substantive Korean research note. Distinguish original video claim vs later research, correlation vs causation, evidence strength and limitations. Use ONLY receipts actually read. Return JSON {sections:[{title:string,paragraphs:[{text:string,sourceIds:string[]}]}],remainingQuestions:string[]}. Each paragraph cites receipt IDs. No URLs or image Markdown in text. Do not turn a result snippet into a source. Original claim is not independent proof.\nTOPIC:${JSON.stringify(run.topic)}\nVIDEO CLAIM:${JSON.stringify(original.slice(0, 18000))}\nREAD RECEIPTS:${JSON.stringify(run.sources.map(s => ({ ...s, text: s.text.slice(0, 11000) })))}`, () => {}, { maxTokens: 10000 }))
    const clean = (s: unknown) => typeof s === 'string' ? s.replace(/[\r\n]/g, ' ').slice(0, 20000) : ''
    const sections = Array.isArray(result.sections) ? result.sections : []
    if (!sections.length) throw new Error('조사 결과가 비어 있습니다.')
    const body = sections.map((section: any) => {
      const paragraphs = (Array.isArray(section.paragraphs) ? section.paragraphs : []).map((p: any) => {
        const text = clean(p.text), ids: string[] = Array.isArray(p.sourceIds) ? p.sourceIds : []
        if (!ids.length || ids.some(id => !run.sources.some(s => s.id === id)) || /\]\(|https?:|!\[/.test(text)) throw new Error('조사 결과의 출처를 확인하지 못했습니다.')
        return text + '\n\n' + ids.map(id => { const s = run.sources.find(s => s.id === id)!; return `[${id}: ${s.title.replace(/[\[\]]/g, '')}](${s.url})` }).join(' · ')
      })
      return `## ${clean(section.title).replace(/#/g, '')}\n\n${paragraphs.join('\n\n')}`
    }).join('\n\n')
    const questions = (Array.isArray(result.remainingQuestions) ? result.remainingQuestions : []).map((q: unknown) => '- ' + clean(q)).join('\n')
    run.markdown = `# 추가 조사: ${clean(run.topic)}\n\n영상의 원래 주장과 구분한 후속 조사입니다.\n\n${body}${questions ? '\n\n## 남은 질문\n\n' + questions : ''}\n\n## 읽은 자료\n\n${run.sources.map(s => `- [${s.title.replace(/[\[\]]/g, '')}](${s.url}) · 조회 ${s.accessedAt.slice(0, 10)}${s.publishedAt ? ' · 발행 ' + s.publishedAt : ''}`).join('\n')}\n`
    run.phase = deadline.aborted || errors.length ? 'partial' : 'ready'; run.message = `${run.sources.length}개 원문으로 작성했습니다.${errors.length ? ' 일부 검색·원문은 접근하지 못했습니다.' : ''}${deadline.aborted ? ' 조사 시간 상한에 도달했습니다.' : ''}`; save()
  } catch (error) { run.phase = signal.aborted ? 'cancelled' : 'failed'; run.message = error instanceof Error ? error.message : String(error); save(); throw error }
}
