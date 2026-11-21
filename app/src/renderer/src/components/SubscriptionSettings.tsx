import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SUBSCRIPTION_MODELS, REASONING_EFFORTS, type ReasoningEffort, type SubscriptionModel, type SubscriptionStatus } from '../../../shared/subscription'

const size = (n: number) => `${(n / 1e9).toFixed(2)} GB`

export function SubscriptionSettings() {
  const [state, setState] = useState<SubscriptionStatus>()
  const [choice, setChoice] = useState<SubscriptionModel>('gpt-6.2-sol')
  const [effort, setEffort] = useState<ReasoningEffort>('xhigh')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const listed = !choice.startsWith('gpt-') || !state?.codexModels || state.codexModels.some(m => m.id === choice)
  const reload = async () => { const s = await window.yogurt.subscription.status(); setState(s); setChoice(s.model); setEffort(s.effort) }
  useEffect(() => { void reload().catch(e => { setMessage(String(e)); setFailed(true) }) }, [])
  const apply = async () => {
    setBusy(true); setMessage('구독 연결을 확인하고 있습니다…'); setFailed(false)
    try {
      const result = await window.yogurt.subscription.apply(choice, effort)
      setMessage(result.message); setFailed(!result.ok)
      if (result.ok) await reload()
    } catch (e) { setMessage(String(e)); setFailed(true) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    setBusy(true); setFailed(false)
    try { const n = await window.yogurt.subscription.removeLocal(); await reload(); setMessage(`로컬 요약·검색 모델 ${size(n)}를 정리했습니다. 녹음과 전사는 보존됩니다.`) }
    catch (e) { setMessage(String(e)); setFailed(true) }
    finally { setBusy(false) }
  }
  return <section data-testid="subscription-settings">
    <h2 className="settings-section-heading">AI 구독 및 모델</h2>
    <div className="settings-group">
      <div className="settings-row"><div className="settings-row-copy">
        <p className="settings-label">정리 · 질문 답변의 기본 AI</p>
        <p className="settings-description">선택한 구독 모델에 전사문과 질문을 보내 처리합니다. 해당 구독의 사용 한도가 적용됩니다.</p>
      </div></div>
      <div className="settings-row"><label htmlFor="subscription-provider" className="settings-label settings-row-copy">구독 공급자</label><span className="settings-select-wrap"><select id="subscription-provider" data-testid="subscription-provider" className="settings-select" value={choice.startsWith('gpt-') ? 'codex' : 'claude'} onChange={e => setChoice(e.target.value === 'codex' ? 'gpt-6.2-sol' : 'claude-sonnet-5-5')} disabled={busy || !state}><option value="codex">ChatGPT · Codex</option><option value="claude">Claude · Claude Code</option></select><ChevronDown size={14} /></span></div>
      <div className="settings-row">
        <label htmlFor="subscription-model" className="settings-label settings-row-copy">사용할 모델</label>
        <span className="settings-select-wrap"><select id="subscription-model" data-testid="subscription-model" className="settings-select" value={choice} onChange={e => { setChoice(e.target.value as SubscriptionModel); setMessage('기본 설정 저장을 눌러 적용하세요. 저장에는 모델을 호출하지 않습니다.'); setFailed(false) }} disabled={busy || !state}>
          {SUBSCRIPTION_MODELS.filter(m => m.provider === (choice.startsWith('gpt-') ? 'codex' : 'claude')).map(m => <option key={m.id} value={m.id}>{m.name}{m.provider === 'codex' && state?.codexModels && !state.codexModels.some(a => a.id === m.id) ? ' · 현재 구독 목록에 없음' : ''}</option>)}
        </select><ChevronDown size={14} aria-hidden="true" /></span>
      </div>
      <div className="settings-row"><div className="settings-row-copy"><p className="settings-label">구독 연결</p><p className="settings-description">{choice.startsWith('gpt-') ? `ChatGPT ${state?.codexPlan && state.codexPlan !== 'unknown' ? state.codexPlan : '구독'} · 공식 Codex 로그인` : 'Claude 구독 · 공식 Claude Code 로그인'} · 요금제와 사용 한도는 로그인한 계정에 적용됩니다.</p>{!listed && <p className="organizer-error">선택한 모델이 이 계정의 현재 구독 목록에 없습니다. 설정값은 유지할 수 있지만, 생성 전에 사용 가능한 모델을 선택해 주세요.</p>}</div></div>
      <div className="settings-row"><label htmlFor="subscription-effort" className="settings-label settings-row-copy">추론 강도</label><span className="settings-select-wrap"><select id="subscription-effort" data-testid="subscription-effort" className="settings-select" value={effort} disabled={busy || !state} onChange={e => setEffort(e.target.value as ReasoningEffort)}>{REASONING_EFFORTS.map(e => <option key={e} value={e}>{e === 'xhigh' ? 'xhigh · 매우 높음' : e}</option>)}</select><ChevronDown size={14} aria-hidden="true" /></span></div>
      <div className="settings-row"><div className="settings-row-copy">
        <p className="settings-label">{state ? SUBSCRIPTION_MODELS.find(m => m.id === state.model)?.name : '연결 확인 중…'}</p>
        <p className="settings-description">{state?.claude.label ?? 'Claude 구독 확인 중…'} · {state?.codex.label ?? 'ChatGPT 구독 확인 중…'}</p>
      </div><button className="workspace-button settings-action" data-testid="subscription-apply" disabled={busy || !state} onClick={() => void apply()}>{busy ? '저장 중…' : '기본 설정 저장'}</button></div>
      <div className="settings-row"><div className="settings-row-copy"><p className="settings-label">연결 시험</p><p className="settings-description">먼저 설정을 저장하세요. 시험을 누를 때만 저장한 모델로 짧은 응답 1회를 요청합니다. 실패해도 다른 모델로 자동 전환하지 않습니다.</p></div><button className="workspace-button settings-action" data-testid="subscription-test" disabled={busy || !state || choice !== state.model || effort !== state.effort} onClick={async () => { setBusy(true); try { const r = await window.yogurt.subscription.test(); setMessage(r.message); setFailed(!r.ok) } catch (e) { setMessage(String(e)); setFailed(true) } finally { setBusy(false) } }}>소량 연결 시험</button></div>
      <div className="settings-row"><div className="settings-row-copy">
        <p className="settings-label">음성 → 텍스트: Whisper large-v3-turbo</p>
        <p className="settings-description">음성 전사는 이 컴퓨터에서 처리합니다. 위 구독 모델은 요약과 질문 답변에 사용합니다.</p>
      </div></div>
      <div className="settings-row"><div className="settings-row-copy">
        <p className="settings-label">로컬 Gemma 요약·검색 모델</p>
        <p className="settings-description">{state ? size(state.localModelBytes) : '용량 확인 중…'} · 사용하지 않으며 자동으로 내려받지 않습니다.</p>
      </div>{!!state?.localModelBytes && <button className="workspace-button settings-action" data-testid="subscription-remove-local" disabled={busy} onClick={() => void remove()}>다운로드 파일 정리</button>}</div>
      {!!message && <div className="settings-row"><p role={failed ? 'alert' : 'status'} data-testid="subscription-message" className="settings-description">{message}</p></div>}
    </div>
  </section>
}
