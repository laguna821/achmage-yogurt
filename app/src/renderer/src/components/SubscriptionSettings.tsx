import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { SUBSCRIPTION_MODELS, type SubscriptionModel, type SubscriptionStatus } from '../../../shared/subscription'

const size = (n: number) => `${(n / 1e9).toFixed(2)} GB`

export function SubscriptionSettings() {
  const [state, setState] = useState<SubscriptionStatus>()
  const [choice, setChoice] = useState<SubscriptionModel>('claude-sonnet-5-5')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const reload = async () => { const s = await window.yogurt.subscription.status(); setState(s); setChoice(s.model) }
  useEffect(() => { void reload().catch(e => { setMessage(String(e)); setFailed(true) }) }, [])
  const apply = async () => {
    setBusy(true); setMessage('구독 연결을 확인하고 있습니다…'); setFailed(false)
    try {
      const result = await window.yogurt.subscription.apply(choice)
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
        <p className="settings-label">요약 · 질문 답변</p>
        <p className="settings-description">선택한 구독 모델에 전사문과 질문을 보내 처리합니다. 해당 구독의 사용 한도가 적용됩니다.</p>
      </div></div>
      <div className="settings-row">
        <label htmlFor="subscription-model" className="settings-label settings-row-copy">사용할 모델</label>
        <span className="settings-select-wrap"><select id="subscription-model" data-testid="subscription-model" className="settings-select" value={choice} onChange={e => { setChoice(e.target.value as SubscriptionModel); setMessage('연결 확인 후 적용을 눌러 저장하세요.'); setFailed(false) }} disabled={busy || !state}>
          {SUBSCRIPTION_MODELS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select><ChevronDown size={14} aria-hidden="true" /></span>
      </div>
      <div className="settings-row"><div className="settings-row-copy">
        <p className="settings-label">{state ? SUBSCRIPTION_MODELS.find(m => m.id === state.model)?.name : '연결 확인 중…'}</p>
        <p className="settings-description">{state?.claude.label ?? 'Claude 구독 확인 중…'} · {state?.codex.label ?? 'ChatGPT 구독 확인 중…'}</p>
      </div><button className="workspace-button settings-action" data-testid="subscription-apply" disabled={busy || !state} onClick={() => void apply()}>{busy ? '확인 중…' : '연결 확인 후 적용'}</button></div>
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
