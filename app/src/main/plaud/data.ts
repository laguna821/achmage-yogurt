/** Official MCP responses may be JSON text wrapped in an untrusted-data marker. Never execute that text. */
export function mcpData(result: any): any {
  if (result?.isError) throw new Error('Plaud 요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.')
  if (result?.structuredContent) return result.structuredContent
  for (const item of result?.content ?? []) {
    if (item.type !== 'text') continue
    const text = String(item.text)
    if (/Block "transaction" (?:not available|has no content)/.test(text)) return []
    try { return JSON.parse(text) } catch { /* official wrapper */ }
    // Preserve the outer container: a one-item array must not become its inner object.
    for (const open of ['{', '['].filter(c=>text.includes(c)).sort((a,b)=>text.indexOf(a)-text.indexOf(b))) {
      const start = text.indexOf(open), end = text.lastIndexOf(open === '{' ? '}' : ']')
      if (start >= 0 && end > start) try { return JSON.parse(text.slice(start, end + 1)) } catch { /* next shape */ }
    }
  }
  throw new Error('Plaud 응답 형식을 확인하지 못했습니다. 앱 업데이트를 확인하세요.')
}
export function recordingId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('Plaud 녹음 ID를 확인하세요.')
  return value
}
export function recordingList(value: any) {
  const rows = Array.isArray(value) ? value : value?.data?.files ?? value?.data?.data ?? value?.data ?? value?.files
  if (!Array.isArray(rows)) throw new Error('Plaud 녹음 목록을 읽지 못했습니다.')
  return rows.map(row => ({ id: recordingId(row.id), name: String(row.name || 'Plaud 녹음').slice(0,200), createdAt: String(row.start_at || row.created_at || ''), durationMs: Math.max(0,Number(row.duration) || 0) }))
}
/** Only HTTPS object storage used by Plaud; never follow a signed link into local services. */
export function audioURL(raw: unknown): URL {
  if (typeof raw !== 'string') throw new Error('원음이 아직 준비되지 않았습니다. Plaud 동기화를 확인하고 다시 시도하세요.')
  const u = new URL(raw), h = u.hostname.toLowerCase()
  if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443' || !['plaud.ai','amazonaws.com','cloudfront.net','aliyuncs.com'].some(domain => h === domain || h.endsWith('.'+domain))) throw new Error('Plaud 원음 다운로드 주소를 확인하지 못했습니다. 공식 앱에서 파일을 내보내 가져올 수 있습니다.')
  return u
}

/** Plaud transaction timestamps are milliseconds, verified against the official MCP response.
 * Fail closed on unknown shapes: never discard utterances or silently guess time units. */
export function transcriptPage(value: any, offset: number, fileId: string) {
  const rows = Array.isArray(value) ? value : value?.segments
  if (!Array.isArray(rows)) throw new Error('Plaud 전사 형식이 지원되지 않습니다. 전사 파일을 내보내 가져올 수 있습니다.')
  if (!Array.isArray(value) && ((value.file_id != null && value.file_id !== fileId) || (value.block != null && value.block !== 'transaction') || (value.offset != null && value.offset !== offset))) throw new Error('Plaud 전사 페이지 순서가 바뀌었습니다. 다시 가져오세요.')
  const turns = rows.map((row: any) => {
    const text = row.content, startMs = row.start_time, endMs = row.end_time
    if (typeof text !== 'string' || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs < startMs) throw new Error('Plaud 전사의 발언 또는 시간 정보를 확인하지 못했습니다.')
    return { text, startMs: Math.round(startMs), endMs: Math.round(endMs), speaker: typeof row.speaker === 'string' ? row.speaker : null }
  })
  const next = value?.next_cursor
  if (next != null && (typeof next !== 'string' || !next || next.length > 4096 || !rows.length)) throw new Error('Plaud 전사 페이지 연결을 확인하지 못했습니다.')
  const total = value?.total
  if (total != null && (!Number.isSafeInteger(total) || total < offset + rows.length || (!next && total !== offset + rows.length))) throw new Error('Plaud 전사를 모두 가져오지 못했습니다. 다시 시도하세요.')
  return { turns, next: next as string | undefined, total: total as number | undefined }
}

/** Retain Plaud-generated notes as fallible secondary evidence, not the final Achmage document. */
export function plaudNotes(value: any): string {
  const rows=Array.isArray(value)?value:value?.data
  if(!Array.isArray(rows))throw new Error('Plaud 정리본 형식을 확인하지 못했습니다.')
  const blocks=rows.map((row:any)=>{
    if(row.data_content_error)throw new Error('Plaud 정리본 내용이 아직 준비되지 않았습니다.')
    if(row.data_content==null||row.data_content==='')return ''
    if(typeof row.data_content!=='string')throw new Error('Plaud 정리본 내용 형식을 확인하지 못했습니다.')
    return '## '+String(row.data_title||row.data_tab_name||'Plaud 정리본').slice(0,200)+'\n\n'+row.data_content
  }).filter(Boolean)
  const text=blocks.join('\n\n---\n\n')
  if(text.length>1_000_000)throw new Error('Plaud 정리본이 너무 큽니다. 필요한 정리본을 파일로 첨부하세요.')
  return text
}
