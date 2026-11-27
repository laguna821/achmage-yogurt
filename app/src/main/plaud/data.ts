/** Official MCP responses may be JSON text wrapped in an untrusted-data marker. Never execute that text. */
export function mcpData(result: any): any {
  if (result?.isError) throw new Error('Plaud 요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.')
  if (result?.structuredContent) return result.structuredContent
  for (const item of result?.content ?? []) {
    if (item.type !== 'text') continue
    const text = String(item.text)
    try { return JSON.parse(text) } catch { /* official wrapper */ }
    for (const open of ['{', '[']) {
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
