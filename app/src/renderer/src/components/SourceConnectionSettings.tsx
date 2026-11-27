import { PlaudConnectionSettings } from './PlaudWorkspace'
import { useEffect, useState } from 'react'
import type { GmailStatus } from '../../../main/organizer/gmail'

export function SourceConnectionSettings() {
  const [vault,setVault] = useState('')
  useEffect(()=>{void window.yogurt.organizer.vault.get().then(setVault)},[])
  const [state, setState] = useState<GmailStatus>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const refresh = () => window.yogurt.organizer.gmail.status().then(setState)
  useEffect(() => { void refresh().catch(e => setError(String(e))) }, [])
  useEffect(() => { if (!state?.connecting) return; const timer = setInterval(() => { void refresh() }, 2000); return () => clearInterval(timer) }, [state?.connecting])
  const act = async (fn: () => Promise<GmailStatus>) => { setBusy(true); setError(''); try { setState(await fn()) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  return <section data-testid="source-connection-settings">
    <h2 className="settings-section-heading">자료 연결</h2>
    <PlaudConnectionSettings/>
    <div className="settings-group">
      <div className="settings-row"><div className="settings-row-copy"><p className="settings-label">Gmail</p><p className="settings-description">{state?.connected ? `${state.account || 'Google 계정'} · 읽기 연결됨` : '이 컴퓨터에서 사용할 Google 계정을 연결하세요.'}</p><p className="settings-description">{state?.message}</p></div></div>
      {!state?.configured && <div className="settings-row"><div className="settings-row-copy"><p className="settings-label">처음 연결하기</p><p className="settings-description">개인용 Google Desktop OAuth 클라이언트를 만들고 내려받은 JSON을 등록하면, 이후에는 Google 로그인으로 연결합니다.</p></div><button className="workspace-button settings-action" onClick={() => void window.yogurt.organizer.gmail.guide()}>Google 설정 안내</button></div>}
      <div className="settings-row"><div className="settings-row-copy"><p className="settings-label">관련 메일 검색·본문 읽기</p><p className="settings-description">정리 준비 창에서 고른 메일이나, 확인 대장의 특정 질문과 날짜 범위에 맞는 메일을 자료로 사용합니다. 인증 정보는 이 컴퓨터에 저장합니다.</p></div></div>
      <div className="settings-row organizer-connection-actions"><button data-testid="gmail-import-client" className="workspace-button" disabled={busy || state?.connecting} onClick={() => void act(() => window.yogurt.organizer.gmail.importClient())}>{state?.configured ? 'Google 연결 설정 변경' : 'OAuth 클라이언트 JSON 등록'}</button><button data-testid="gmail-connect" className="workspace-button primary" disabled={busy || !state?.configured || state?.connecting} onClick={() => void act(() => window.yogurt.organizer.gmail.connect())}>{state?.connecting ? '브라우저에서 로그인 중…' : state?.connected ? '다시 로그인' : 'Google 로그인'}</button>{state?.connected && <button data-testid="gmail-disconnect" className="workspace-button" disabled={busy} onClick={() => void act(() => window.yogurt.organizer.gmail.disconnect())}>연결 해제</button>}</div>
      {error && <div className="settings-row"><p role="alert" className="settings-description">{error}</p></div>}
    </div>
    <div className="skin-controls"><span>볼트 폴더: {vault || '선택하지 않음 · 기존 Achmage 연결 사용'}</span><button onClick={()=>void window.yogurt.organizer.vault.choose().then(setVault)}>볼트 폴더 선택</button>{vault && <button onClick={()=>void window.yogurt.organizer.vault.clear().then(setVault)}>폴더 연결 해제</button>}</div>
    <div className="settings-group"><div className="settings-row"><div className="settings-row-copy"><p className="settings-label">Obsidian·Achmage 볼트 / 공개 웹</p><p className="settings-description">이 컴퓨터의 Achmage 및 웹 검색 연결을 사용합니다. 기록마다 준비 창에서 탐색 범위를 고를 수 있고, 실제 사용한 출처와 연결 실패는 근거 대장에 남습니다.</p></div></div></div>
  </section>
}
