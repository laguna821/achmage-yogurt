import { useEffect, useState } from 'react'
import { FilePlus2, Clipboard, Settings2, CheckCircle2, Loader, MessageCircleQuestion, X, FolderOpen } from 'lucide-react'
import { Modal } from './Modal'
import type { OrganizerState, OrganizerOptions, OrganizerContext, RecordKind } from '../../../shared/organizer'
import type { SubscriptionStatus } from '../../../shared/subscription'

const kinds: [RecordKind, string][] = [['auto', '내용을 보고 자동 판단'], ['meeting', '회의'], ['lecture', '강의·수업'], ['own-lecture', '내 강의'], ['seminar', '세미나'], ['colloquium', '콜로퀴움'], ['conversation', '카페 대화·일상 대화'], ['interview', '인터뷰'], ['other', '그 밖의 녹음']]
const active = (s?: OrganizerState) => !!s && !['idle', 'questions', 'ready', 'failed', 'interrupted'].includes(s.phase)
const files64 = (files: File[]) => Promise.all(files.map(file => new Promise<{ name: string; data: string }>((resolve, reject) => {
  if (file.size > 20_000_000) return reject(new Error('파일 한 개는 20MB까지 첨부할 수 있습니다.'))
  const reader = new FileReader(); reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.')); reader.onload = () => resolve({ name: file.name, data: String(reader.result).split(',')[1] || '' }); reader.readAsDataURL(file)
})))
const sourcesSettings = () => { sessionStorage.setItem('settings-section', 'sources'); window.yogurt.nav.go('/settings') }

export function OrganizerWorkspace({ id, open, setOpen, beforeStart, edited }: { id: string; open: boolean; setOpen: (v: boolean) => void; beforeStart: () => Promise<boolean>; edited: boolean }) {
  const [state, setState] = useState<OrganizerState>(), [model, setModel] = useState<SubscriptionStatus>(), [options, setOptions] = useState<OrganizerOptions>(), [context, setContext] = useState<OrganizerContext>({ notes: '', participants: '', links: '' })
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [mailQuery, setMailQuery] = useState(''), [answers, setAnswers] = useState<Record<string, string>>({})
  useEffect(() => {
    let current = true
    void window.yogurt.organizer.get(id).then(s => { if (current) { setState(s); setOptions(s.options); setContext(s.context || { notes: '', participants: '', links: '' }) } }).catch(e => setError(String(e)))
    const stop = window.yogurt.organizer.onChange(s => { if (current && s.meetingId === id) setState(s) })
    return () => { current = false; stop() }
  }, [id])
  useEffect(() => { if (open) void window.yogurt.subscription.status().then(setModel).catch(() => {}) }, [open])
  useEffect(() => { setAnswers({}) }, [state?.runId])
  const action = async (fn: () => Promise<unknown>) => { setWorking(true); setError(''); try { await fn() } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e)) } finally { setWorking(false) } }
  const store = async () => { if (options) setState(await window.yogurt.organizer.configure(id, options, context)) }
  const start = () => action(async () => {
    if (!await beforeStart()) return
    await store(); setOpen(false)
    // Start returns when the queued job finishes; progress arrives independently.
    await window.yogurt.organizer.start(id)
  })
  const upload = (files: File[]) => action(async () => { setState(await window.yogurt.organizer.attachBytes(id, await files64(files))) })
  const busy = active(state)
  return <div className="organizer-workspace" data-testid="organizer-workspace">
    <div className="organizer-toolbar"><div className="organizer-status" role="status">{busy ? <Loader size={15} className="animate-spin" /> : state?.phase === 'questions' ? <MessageCircleQuestion size={16} /> : <CheckCircle2 size={15} />}<span>{state?.message || '정리할 자료와 맥락을 먼저 모아 주세요.'}</span></div><button data-testid="organizer-prepare" className="workspace-button" disabled={busy || working} onClick={() => setOpen(true)}><Settings2 size={14} />자료·정리 설정</button></div>
    {error && <p role="alert" className="organizer-error">{error}</p>}
    {state?.questions.some(q => !q.answer) && !busy && <section className="organizer-questions" data-testid="organizer-questions"><h3>확인하면 더 정확해지는 내용</h3><p>초안은 이미 저장돼 있습니다. 자료로 풀리지 않은 중요한 항목만 모았습니다. 선택지 또는 직접 입력으로 한 번에 답해 주세요.</p>{state.questions.map((q, n) => <fieldset key={q.id}><legend>Q{n + 1}. {q.question}</legend><p>{q.basis}</p><label>답변<select data-testid={`organizer-answer-${q.id}`} value={answers[q.id] ?? '__DEFAULT__'} onChange={e => setAnswers({ ...answers, [q.id]: e.target.value })}><option value="__DEFAULT__">기본값 유지: {q.defaultAnswer}</option>{q.options.filter(o => o !== q.defaultAnswer).map(o => <option key={o} value={o}>{o}</option>)}<option value="__CUSTOM__">직접 입력</option></select></label>{answers[q.id] === '__CUSTOM__' && <textarea aria-label={`${q.question} 직접 답변`} onChange={e => setAnswers(a => ({ ...a, [`${q.id}-text`]: e.target.value }))} placeholder="기억하는 이름·날짜·담당자와 근거를 적어 주세요." />}</fieldset>)}<div className="organizer-actions"><button className="workspace-button primary" disabled={working} data-testid="organizer-apply-answers" onClick={() => void action(async () => { if (!await beforeStart()) return; const values = Object.fromEntries(state.questions.map(q => [q.id, answers[q.id] === '__CUSTOM__' ? answers[`${q.id}-text`] || '__DEFAULT__' : answers[q.id] || '__DEFAULT__'])); await window.yogurt.organizer.answer(id, values) })}>답변을 반영해 다시 정리</button><button className="workspace-button" disabled={working} onClick={() => void action(() => window.yogurt.organizer.answer(id, {}, true))}>기본값으로 초안 사용</button></div></section>}
    {state?.runId && <details className="organizer-ledger" data-testid="organizer-ledger"><summary>근거·화자·보정·검수 보기</summary><div className="organizer-connection-list">{state.connectors.map(c => <p key={c.provider}><strong>{c.provider === 'vault' ? '볼트' : c.provider === 'mail' ? '메일' : '웹'}</strong> · {c.detail}</p>)}</div>{state.speakers.length > 0 && <table><thead><tr><th>화자·범위</th><th>대응</th><th>확신·근거</th></tr></thead><tbody>{state.speakers.map((s, n) => <tr key={n}><td>{s.label}<br />{s.scope}</td><td>{s.name}</td><td>{s.confidence === 'confirmed' ? '확정' : s.confidence === 'likely' ? '유력' : '미정'} · {s.basis} {s.sourceIds.join(', ')}</td></tr>)}</tbody></table>}{state.findings.map((f, n) => <p key={n}><strong>{f.original} → {f.value || '미확인'}</strong><br />{f.basis} · {f.sourceIds.join(', ')}</p>)}<h4>사용한 자료</h4>{state.evidence.map(e => <details key={e.id}><summary>[{e.id}] {e.title}</summary><p>{e.locator}</p><pre>{e.text}</pre></details>)}<h4>검수</h4>{state.checks.map((c, n) => <p key={n}>{c}</p>)}<button className="workspace-button" onClick={() => void window.yogurt.organizer.openWork(id)}><FolderOpen size={14} />원문·확인 대장 폴더 열기</button></details>}
    {open && options && <Modal title="전사록 정리에 필요한 맥락이 담긴 자료가 있나요?" description="회의·강의·대화의 사전 정보를 편하게 모아 주세요. 자료가 없어도 원문부터 정리하고, 꼭 필요한 확인만 나중에 묻습니다." testId="organizer-preflight" onCancel={() => { void action(async () => { await store(); setOpen(false) }) }} busy={working || busy}>
      <button className="organizer-modal-close" aria-label="정리 준비 닫기" disabled={working || busy} onClick={() => void action(async () => { await store(); setOpen(false) })}><X size={19} /></button>
      <div className="organizer-preflight" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) void upload([...e.dataTransfer.files]) }}>
        <div className="organizer-form-grid"><label>어떤 녹음인가요?<select data-testid="organizer-kind" value={options.kind} onChange={e => setOptions({ ...options, kind: e.target.value as RecordKind })}>{kinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>어떤 글로 만들까요?<select data-testid="organizer-profile" value={options.profile} onChange={e => setOptions({ ...options, profile: e.target.value as OrganizerOptions['profile'] })}><option value="record">자세한 정리본</option><option value="minutes">배포용 회의록</option></select></label></div>
        <label>떠오르는 맥락을 자유롭게 적거나 붙여넣으세요<textarea data-testid="organizer-context" data-dialog-focus value={context.notes} onChange={e => setContext({ ...context, notes: e.target.value })} onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); void upload([...e.clipboardData.files]) } }} placeholder="예: 오늘 무슨 자리였는지, 카톡에서 정한 내용, 메일 본문, 수기 메모, 발표 주제, 헷갈린 용어… 정돈하지 않고 넣어도 됩니다." rows={5} /></label>
        <div className="organizer-form-grid organizer-clue-grid"><label>사람·발화자 단서 <span>(아는 만큼만)</span><textarea data-testid="organizer-participants" value={context.participants} onChange={e => setContext({ ...context, participants: e.target.value })} placeholder="예: 나는 안창현, 사회는 ○○, 발표자는 △△. 10분쯤 장비 이야기를 한 사람은… / 모르면 비워 두세요." rows={2} /></label>
        <label>참고 링크 <span>(한 줄에 하나)</span><textarea data-testid="organizer-links" value={context.links} onChange={e => setContext({ ...context, links: e.target.value })} placeholder="웹 자료·행사 페이지·공유 문서 링크. 로그인이 필요한 페이지는 파일이나 본문을 함께 넣으면 도움이 됩니다." rows={2} /></label></div>
        <div className="organizer-dropzone"><strong>파일을 여기에 놓거나 여러 개를 한꺼번에 첨부하세요</strong><p>회의·강의 자료, PDF, Word, TXT·MD·CSV·JSON, 이메일 EML, 카톡 내보내기, 스크린샷·사진. 파일당 20MB, 최대 12개.</p><div className="organizer-actions"><button className="workspace-button" disabled={working} onClick={() => void action(async () => setState(await window.yogurt.organizer.attach(id)))}><FilePlus2 size={14} />파일 첨부</button><button className="workspace-button" disabled={working} onClick={() => void action(async () => setState(await window.yogurt.organizer.pasteImage(id)))}><Clipboard size={14} />클립보드 이미지</button></div>{state?.evidence.filter(e => e.provider === 'attached' || e.provider === 'mail' && e.issueIds.length === 0).map(e => <div className="organizer-attachment" key={e.id}><span>{e.imagePath ? '이미지 · 시작 후 읽기' : '자료 읽음'} · {e.title}</span><button aria-label={`${e.title} 첨부 제외`} onClick={() => void action(async () => setState(await window.yogurt.organizer.remove(id, e.id)))}><X size={14} /></button></div>)}</div>
        <details><summary>Gmail에서 관련 메일 가져오기</summary><p>먼저 <button className="organizer-link" onClick={() => void action(async () => { await store(); sourcesSettings() })}>설정 → 자료 연결</button>에서 이 컴퓨터의 Gmail을 연결하세요.</p><div className="organizer-mail-search"><input aria-label="관련 메일 검색어" value={mailQuery} onChange={e => setMailQuery(e.target.value)} placeholder="예: after:2026/11/01 미디어스쿨 워크숍" /><button className="workspace-button" disabled={working || !mailQuery.trim()} onClick={() => void action(async () => setState(await window.yogurt.organizer.mailSearch(id, mailQuery)))}>관련 메일 최대 3건 가져오기</button></div></details>
        <fieldset className="organizer-scope"><legend>부족한 맥락을 찾을 곳</legend>{(['vault', 'mail', 'web'] as const).map(key => <label key={key}><input type="checkbox" checked={options[key]} onChange={e => setOptions({ ...options, [key]: e.target.checked })} />{key === 'vault' ? 'Obsidian·Achmage 볼트' : key === 'mail' ? '연결된 Gmail' : '공개 명칭 웹 검색'}</label>)}</fieldset>
        {edited && <p>현재 편집한 정리본은 새 정리가 완성되면 교체됩니다. 원문·자료·이전 결과는 작업 폴더에 남깁니다.</p>}
        {error && <p role="alert" className="organizer-error">{error}</p>}
      </div>
      <div className="organizer-footer">
        <p className="organizer-model">사용할 AI: <strong>{model?.model || '기본 설정'} · {model?.effort || '설정 확인 중'}</strong> <button className="organizer-link" onClick={() => void action(async () => { await store(); sessionStorage.setItem('settings-section', 'ai'); window.yogurt.nav.go('/settings') })}>모델 설정</button></p>
        <div className="organizer-actions organizer-start"><button className="workspace-button" disabled={working || busy} onClick={() => void action(async () => { await store(); setOpen(false) })}>자료만 저장</button><button data-testid="organizer-start" className="workspace-button primary" disabled={working || busy} onClick={() => void start()}>{working ? '자료 처리 중…' : '이 자료로 정리 시작'}</button></div>
      </div>
    </Modal>}
  </div>
}
