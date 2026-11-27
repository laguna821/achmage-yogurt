import type { RecordActivity } from '../shared/activity'
import type { NoteView } from '../shared/types'
import type { OrganizerState } from '../shared/organizer'
import type { VideoState } from '../shared/video'

/** Small, content-free snapshots: no transcript or token-stream IPC for library rows. */
export function createActivity(valid: (id: string) => boolean, changed: (rows: RecordActivity[]) => void) {
  const channels = new Map<string, Map<string, RecordActivity>>()
  const list = () => [...channels].filter(([id]) => valid(id)).flatMap(([, sources]) => {
    const a = sources.get('retry') ?? sources.get('video') ?? sources.get('organizer') ?? sources.get('notes')
    return a ? [a] : []
  })
  const set = (id: string, source: string, state?: RecordActivity['state'], label = '') => {
    const sources = channels.get(id) ?? new Map<string, RecordActivity>()
    const old = sources.get(source)
    if (state && valid(id)) sources.set(source, { meetingId: id, state, label })
    else sources.delete(source)
    if (sources.size) channels.set(id, sources); else channels.delete(id)
    if (old?.state !== state || old?.label !== label) changed(list())
  }
  return { list, set,
    clear(id: string) { channels.delete(id); changed(list()) },
    notes(s: NoteView) {
      set(s.meetingId, 'notes', s.status === 'waiting' ? 'waiting' : s.status === 'writing' ? 'active' : s.status === 'failed' ? 'failed' : undefined,
        s.status === 'waiting' ? '정리 준비 중' : s.status === 'failed' ? '정리 실패 · 기록에서 확인' : s.part ? `전사문 읽는 중 · ${s.part.part}/${s.part.of}` : s.step === 'checking' ? '최종 내용 확인 중' : 'AI 정리 중')
    },
    organizer(s: OrganizerState) {
      set(s.meetingId, 'organizer', ['preparing','researching','matching','drafting','checking'].includes(s.phase) ? 'active' : s.phase === 'questions' ? 'questions' : s.phase === 'failed' ? 'failed' : undefined, s.message)
    },
    video(s: VideoState) {
      const research = s.research.find(r => ['queued','searching','writing'].includes(r.phase))
      set(s.meetingId, 'video', research ? 'active' : s.phase === 'queued' ? 'waiting' : ['downloading','frames','reading','organizing','checking','finalizing'].includes(s.phase) ? 'active' : s.phase === 'questions' ? 'questions' : s.phase === 'failed' ? 'failed' : undefined, research?.message ?? s.message)
    },
  }
}
