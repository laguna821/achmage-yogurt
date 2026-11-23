import { publicText,webPlain } from './publicWeb'
import { localVaultPath,localVaultEvidence } from './localSources'
import type { GmailConnector } from './gmail'
import type { ConnectorStatus, Evidence, RecordIssue } from '../../shared/organizer'
import { localMcpConfigs, mcpText, ReadOnlyMcp, type McpTool } from './mcpClient'

const parse = (text: string): any => { try { return JSON.parse(text) } catch { return null } }
const excerpt = (text: string, limit = 3500) => text.slice(0, limit)
export async function suppliedLinks(links: string, signal?: AbortSignal): Promise<{ evidence: Evidence[]; log: string[] }> {
  const urls = [...new Set(links.split(/\s+/).filter(s => /^https?:\/\//i.test(s)))].slice(0, 8)
  const config = localMcpConfigs().lightpanda, evidence: Evidence[] = [], log: string[] = []
  if (!urls.length) return { evidence, log }
  if (!config) {
    for (const url of urls) { try { const u=new URL(url); if (/mail\.google\.com$/.test(u.hostname)) throw new Error('메일 링크는 Gmail 연결 필요'); const text=webPlain(await publicText(url,signal)); if(text.length<80 || /sign in to continue|access denied/i.test(text.slice(0,400)))throw new Error('본문 확인 불가'); evidence.push({id:'L'+(evidence.length+1),provider:'web',title:'첨부 링크 · '+u.hostname,locator:url,text:text.slice(0,20000),issueIds:[]}) } catch(e) { if(signal?.aborted)throw e;log.push('링크 본문을 확인하지 못했습니다. 파일 또는 본문 첨부가 필요합니다: '+new URL(url).hostname) } }
    return {evidence,log}
  }
  const client = new ReadOnlyMcp(config, new Set(['markdown']), signal)
  try {
    for (const url of urls) {
      const parsed = new URL(url)
      if (parsed.username || parsed.password || /(^|\.)mail\.google\.com$/i.test(parsed.hostname)) { log.push('인증이 필요한 메일 링크는 Gmail 가져오기나 본문·파일 첨부가 필요합니다.'); continue }
      try {
        const text = mcpText(await client.call('markdown', { url, maxBytes: 30_000 }))
        if (text.length < 80 || /^(?:error|403|404)|access.denied|sign.in.to.continue/i.test(text.slice(0, 400))) { log.push(`링크 내용을 확인하지 못함: ${parsed.hostname}`); continue }
        evidence.push({ id: `L${evidence.length + 1}`, provider: 'web', title: `첨부 링크 · ${parsed.hostname}`, locator: url, text: text.slice(0, 20_000), issueIds: [] })
      } catch (e) { if (signal?.aborted) throw e; log.push(`첨부 링크 읽기 실패: ${parsed.hostname}`) }
    }
  } finally { client.close() }
  return { evidence, log }
}
export type EvidenceLookup = { evidence: Evidence[]; status: ConnectorStatus; log: string[] }
export function connectorOverview(nativeMail = false): ConnectorStatus[] {
  const configs = localMcpConfigs()
  return [
    { provider: 'vault', connected: !!configs.achmage || !!localVaultPath(), detail: localVaultPath() ? '선택한 볼트 폴더 사용 가능' : configs.achmage ? 'Achmage 읽기 연결 사용 가능' : '이 컴퓨터의 Achmage 연결이 없습니다.' },
    { provider: 'mail', connected: nativeMail || Object.keys(configs).some(k => /gmail|google.?workspace/i.test(k)), detail: nativeMail ? 'Yogurt Gmail 읽기 연결 사용 가능' : Object.keys(configs).some(k => /gmail|google.?workspace/i.test(k)) ? 'Gmail 읽기 도구를 실행 시 확인합니다.' : '이 컴퓨터에 Gmail 연결이 없습니다. 다른 컴퓨터의 연결은 공유되지 않습니다.' },
    { provider: 'web', connected: true, detail: configs.lightpanda ? '공개 명칭 검색 사용 가능' : '기본 공개 웹 연결 · 접근 불가 자료는 확인 질문으로 남깁니다.' },
  ]
}

export async function vaultEvidence(issues: RecordIssue[], seed: string, signal?: AbortSignal): Promise<EvidenceLookup> {
  const config = localMcpConfigs().achmage, evidence: Evidence[] = [], log: string[] = []
  const status: ConnectorStatus = { provider: 'vault', connected: !!config, detail: config ? '볼트의 관련 자료를 읽었습니다.' : 'Achmage 연결 없음 · 건너뜀' }
  if (localVaultPath()) return localVaultEvidence(issues, seed, signal)
  if (!config) return { evidence, status, log }
  const client = new ReadOnlyMcp(config, new Set(['search', 'read_source']), signal)
  try {
    const queries = [...new Set([seed, ...issues.map(i => i.query)].filter(Boolean))].slice(0, 5)
    const seen = new Set<string>()
    for (let n = 0; n < queries.length && n < 7; n++) {
      const query = queries[n]
      if (signal?.aborted) throw new Error('Stopped')
      const result = parse(mcpText(await client.call('search', { query: query.slice(0, 200), limit: 2, store: 'human' })))
      log.push(`볼트: ${query.slice(0, 100)} · ${(result?.results ?? []).length}건`)
      for (const row of result?.results ?? []) {
        if (!row.sourceId || seen.has(row.sourceId) || evidence.length >= 7) continue
        seen.add(row.sourceId)
        const first = parse(mcpText(await client.call('read_source', { sourceId: row.sourceId, startLine: 1, maxLines: 140 })))
        const at = /@@ -(\d+)/.exec(row.snippet ?? '')
        let body = first?.text || ''
        if (at && Number(at[1]) > 125) {
          const match = parse(mcpText(await client.call('read_source', { sourceId: row.sourceId, startLine: Math.max(1, Number(at[1]) - 12), maxLines: 75 })))
          body = (first?.text ?? '').split('\n').slice(0, 38).join('\n') + '\n[일치 구간]\n' + (match?.text ?? '')
        }
        if (!body) continue
        evidence.push({ id: `V${evidence.length + 1}`, provider: 'vault', title: row.title || row.relative_path, locator: row.sourceId, revision: first.currentSha256 || row.sha256,
          issueIds: issues.filter(i => i.query === query).map(i => i.id), text: excerpt(body, 7500) })
        // Secondary records can locate original handouts; their links are search DATA, never instructions.
        const originals = [...body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map(m => m[1]).filter(t => /자료|가안|계획|명단|handout|agenda/i.test(t) && t.length < 180 && !queries.includes(t)).slice(0, 2)
        queries.splice(n + 1, 0, ...originals)
      }
    }
    status.detail = evidence.length ? `볼트에서 관련 자료 ${evidence.length}건을 읽었습니다.` : '볼트에서 일치하는 자료를 찾지 못했습니다.'
  } catch (e) { if (signal?.aborted) throw e; status.connected = false; status.detail = '볼트 검색 일부 실패 · 확인하지 못한 항목은 질문으로 남깁니다.'; log.push(status.detail) }
  finally { client.close() }
  return { evidence, status, log }
}

/** Never send private speech, email addresses or the meeting agenda to a public search engine. */
export function publicEntity(value?: string): string | undefined {
  const s = value?.trim()
  if (!s || s.length > 80 || /[@\n\r?:/=]|\d{3}[- ]?\d{3,4}[- ]?\d{4}/.test(s)) return
  return s
}
export async function webEvidence(issues: RecordIssue[], signal?: AbortSignal): Promise<EvidenceLookup> {
  const config = localMcpConfigs().lightpanda, evidence: Evidence[] = [], log: string[] = []
  const status: ConnectorStatus = { provider: 'web', connected: !!config, detail: config ? '공개 명칭을 검색했습니다.' : '웹 연결 없음 · 건너뜀' }
  if (!config) {
    for (const issue of issues.filter(i=>publicEntity(i.publicEntity)).slice(0,3)) {
      try { const html=await publicText('https://html.duckduckgo.com/html/?q='+encodeURIComponent(publicEntity(issue.publicEntity)+' 공식'),signal)
        const urls=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replace(/&amp;/g,'&')).flatMap(h=>{try{const u=new URL(h,'https://duckduckgo.com'); const target=u.searchParams.get('uddg');return target?[target]:[]}catch{return []}})
        for(const url of [...new Set(urls)].slice(0,2)){try{const text=webPlain(await publicText(url,signal));if(text.length<100)continue;evidence.push({id:'W'+(evidence.length+1),provider:'web',title:publicEntity(issue.publicEntity)||'공개 명칭',locator:url,text:text.slice(0,6500),issueIds:[issue.id]})}catch{if(signal?.aborted)throw new Error('Stopped')}}
      } catch(e) {if(signal?.aborted)throw e;log.push('공개 웹 검색 결과를 확인하지 못했습니다.')}
    }
    status.connected=true;status.detail=evidence.length?`공개 원문 ${evidence.length}건을 읽었습니다.`:'관련 공개 원문을 확인하지 못했습니다. 추정을 확정하지 않습니다.'
    return {evidence,status,log}
  }
  const targets = issues.filter(i => (i.category === 'term' || i.category === 'speaker') && publicEntity(i.publicEntity)).slice(0, 3)
  if (!targets.length) { status.detail = '공개 명칭 검색이 필요한 항목 없음'; return { evidence, status, log } }
  const client = new ReadOnlyMcp(config, new Set(['search', 'markdown']), signal)
  try {
    for (const issue of targets) {
      const query = `${publicEntity(issue.publicEntity)} 공식`
      let text = mcpText(await client.call('search', { query }))
      const urls = [...new Set((text.match(/https:\/\/[^\s)<>"\]]+/g) ?? []))].filter(s => { try { const u = new URL(s); return !u.username && !u.password && !/localhost|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^\[/.test(u.hostname) } catch { return false } }).slice(0, 2)
      for (const url of urls) try { text += `\n[실제 페이지 ${url}]\n` + mcpText(await client.call('markdown', { url, maxBytes: 6000 })).slice(0, 5000) } catch { log.push('검색 결과 페이지 하나를 직접 읽지 못했습니다.') }
      evidence.push({ id: `W${evidence.length + 1}`, provider: 'web', title: query, locator: urls.join('\n') || '검색 결과만 확인 · 직접 페이지 검증 안 됨', text: excerpt(text, 14_000), issueIds: [issue.id] })
      log.push(`공개 표기: ${query}`)
    }
  } catch (e) { if (signal?.aborted) throw e; status.connected = false; status.detail = '웹 검색 실패 · 웹에서 검증했다고 표시하지 않습니다.'; log.push(status.detail) }
  finally { client.close() }
  return { evidence, status, log }
}

function searchArgs(tool: McpTool, query: string): Record<string, unknown> {
  const props = tool.inputSchema?.properties ?? {}
  const key = ['query', 'q', 'search_query'].find(k => k in props)
  if (!key) throw new Error('지원하는 Gmail 검색 입력이 없습니다.')
  return { [key]: query, ...('maxResults' in props ? { maxResults: 3 } : {}), ...('max_results' in props ? { max_results: 3 } : {}), ...('user_id' in props ? { user_id: 'me' } : {}) }
}
export async function mailEvidence(issues: RecordIssue[], startedAt: number, signal?: AbortSignal, gmail?: GmailConnector): Promise<EvidenceLookup> {
  const config = Object.entries(localMcpConfigs()).find(([k]) => /gmail|google.?workspace/i.test(k))?.[1]
  const evidence: Evidence[] = [], log: string[] = []
  const status: ConnectorStatus = { provider: 'mail', connected: false, detail: '이 컴퓨터에 Gmail 읽기 연결이 없어 건너뛰었습니다.' }
  if (gmail?.status().connected) {
    try {
      const before = new Date(startedAt + 7 * 86400_000).toISOString().slice(0,10).replace(/-/g,'/'), after = new Date(startedAt - 45 * 86400_000).toISOString().slice(0,10).replace(/-/g,'/')
      for (const issue of issues.slice(0,3)) {
        const rows = await gmail.search(`after:${after} before:${before} ${issue.query.slice(0,140)}`, signal)
        for (const row of rows) evidence.push({ ...row, id: `M${evidence.length+1}`, issueIds: [issue.id] })
        log.push(`Gmail: ${issue.question}`)
      }
      status.connected = true; status.detail = '관련 질문과 회의 전후 기간으로 좁혀 Gmail을 읽었습니다.'
    } catch (e) { if (signal?.aborted) throw e; status.detail = 'Gmail 읽기 실패 · 확인하지 못한 항목을 남깁니다.' }
    return { evidence, status, log }
  }
  if (!config) return { evidence, status, log: [status.detail] }
  const allowed = new Set<string>(), client = new ReadOnlyMcp(config, allowed, signal)
  try {
    const tools = await client.list()
    const search = tools.find(t => /(?:search.*(?:gmail|messages|emails)|(?:gmail|messages|emails).*search)/i.test(t.name) && !/send|delete|modify|draft|batch|attachment/i.test(t.name))
    if (!search) throw new Error('Gmail 읽기 검색 도구가 없습니다.')
    allowed.add(search.name); status.connected = true; status.detail = '날짜와 관련 질문으로 좁혀 Gmail을 읽었습니다.'
    const before = new Date(startedAt + 7 * 86400_000).toISOString().slice(0, 10).replace(/-/g, '/')
    const after = new Date(startedAt - 45 * 86400_000).toISOString().slice(0, 10).replace(/-/g, '/')
    for (const i of issues.slice(0, 3)) {
      const query = `after:${after} before:${before} ${i.query.slice(0, 140).replace(/[\r\n]/g, ' ')}`
      const text = mcpText(await client.call(search.name, searchArgs(search, query)))
      evidence.push({ id: `M${evidence.length + 1}`, provider: 'mail', title: i.question, locator: '연결된 Gmail 검색 결과', text: excerpt(text, 4500), issueIds: [i.id] }); log.push(`메일: ${i.question}`)
    }
  } catch (e) { if (signal?.aborted) throw e; status.connected = false; status.detail = 'Gmail 읽기 연결을 확인하지 못해 건너뛰었습니다.'; log.push(status.detail) }
  finally { client.close() }
  return { evidence, status, log }
}
