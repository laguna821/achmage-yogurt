import { useEffect, useMemo, useState } from 'react'
import type { RecordActivity } from '../../shared/activity'
import { isImportFinished, type ImportJob } from '../../shared/imports'

export function useRecordActivity() {
  const [rows, setRows] = useState<RecordActivity[]>([]), [imports, setImports] = useState<ImportJob[]>([])
  useEffect(() => {
    let live = true, rowEvent = false, importEvent = false
    const off = window.yogurt.activity?.onChange(value => { rowEvent = true; setRows(value) })
    const offImports = window.yogurt.imports?.onChange(value => { importEvent = true; setImports(value) })
    void window.yogurt.activity?.list().then(value => { if (live && !rowEvent) setRows(value) }).catch(() => {})
    void window.yogurt.imports?.list().then(value => { if (live && !importEvent) setImports(value) }).catch(() => {})
    return () => { live = false; off?.(); offImports?.() }
  }, [])
  return useMemo(() => {
    const map = new Map(rows.map(row => [row.meetingId, row]))
    // Prefer AI progress when optional original audio is downloading alongside it.
    for (const job of [...imports].reverse()) {
      if (!job.meetingId || job.dismissedAt || map.has(job.meetingId)) continue
      const active = !isImportFinished(job.stage), audio = job.audioStatus === 'pending'
      if (active || audio || job.stage === 'failed' || job.stage === 'interrupted') map.set(job.meetingId, {
        meetingId: job.meetingId, state: job.stage === 'queued' || job.stage === 'waiting' ? 'waiting' : active || audio ? 'active' : 'failed',
        label: audio && !active ? job.audioMessage || '원음 보관 중' : job.message,
      })
    }
    return map
  }, [rows, imports])
}
