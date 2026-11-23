import { useEffect, useState } from 'react'
import { PALETTES, paletteOf, paletteTokens, DEFAULT_APPEARANCE, type Appearance } from '../../../shared/appearance'

export function AppearanceSettings() {
  const [state,setState]=useState<Appearance>(),[filter,setFilter]=useState('all'),[query,setQuery]=useState(''),[error,setError]=useState('')
  useEffect(()=>{ void window.yogurt.appearance.get().then(setState); return window.yogurt.appearance.onChange(setState) },[])
  const apply=async(patch:Partial<Appearance>)=>{try{setState(await window.yogurt.appearance.set(patch));setError('')}catch(e){setError(String(e))}}
  if(!state)return <p>스킨을 불러오고 있습니다.</p>
  const active=paletteOf(state[state.resolved],state.resolved)
  return <section className="appearance-settings" data-testid="appearance-settings">
    <h2>스킨과 색상</h2><p>Atlas 컬러링과 6개 참고 팔레트를 담은 27가지 스킨입니다.</p>
    <div className="skin-controls"><label>화면 모드 <select aria-label="스킨 화면 모드" value={state.mode} onChange={e=>void apply({mode:e.target.value as Appearance['mode']})}><option value="system">시스템에 맞춤</option><option value="light">라이트</option><option value="dark">다크</option></select></label><button onClick={()=>void apply({...DEFAULT_APPEARANCE,mode:'system'})}>기본 스킨 복원</button></div>
    <div className="skin-preview" style={Object.fromEntries(Object.entries(paletteTokens(active)))}><strong>{active.name}</strong><p>한국어 강의와 English 용어를 함께 정리합니다.</p><span className="skin-preview-tag">확인 질문 2개</span><button>정리 시작</button></div>
    <div className="skin-controls"><input aria-label="스킨 검색" placeholder="스킨 검색" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="스킨 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체 27개</option><option value="light">라이트</option><option value="dark">다크</option><option value="favorites">즐겨찾기</option></select></div>
    <p>자동 모드에서는 라이트·다크 스킨을 각각 기억합니다. 현재 선택: {paletteOf(state.light,'light').name} / {paletteOf(state.dark,'dark').name}</p>
    <div className="skin-grid">{PALETTES.filter(p=>(filter==='all'||filter===p.mode||filter==='favorites'&&state.favorites.includes(p.id))&&p.name.toLowerCase().includes(query.toLowerCase())).map(p=>{
      const selected=state[p.mode]===p.id, colors=paletteTokens(p)
      return <div className={'skin-card'+(selected?' selected':'')} key={p.id}>
        <button className="skin-choose" aria-pressed={selected} data-testid={'skin-'+p.id} onClick={()=>void apply({[p.mode]:p.id,...(state.mode==='system'?{}:{mode:p.mode})})}>
          <span className="skin-swatches">{['--bg','--chrome','--accent','--ink'].map(key=><i key={key} style={{background:colors[key]}}/>)}</span><strong>{p.name}</strong><small>{p.mode==='light'?'라이트':'다크'}{selected?' · 선택됨':''}</small>
        </button><button className="skin-favorite" aria-label={p.name+' 즐겨찾기'} aria-pressed={state.favorites.includes(p.id)} onClick={()=>void apply({favorites:state.favorites.includes(p.id)?state.favorites.filter(id=>id!==p.id):[...state.favorites,p.id]})}>{state.favorites.includes(p.id)?'★':'☆'}</button>
      </div>
    })}</div>{error&&<p role="alert">{error}</p>}
  </section>
}
