import { useId } from 'react'
import wordmark from '../../../shared/achmage-wordmark.json'

/** The Yogurt mark. */
export function Logo({ size = 28, className = 'text-accent' }: { size?: number; className?: string }) {
  const mask = useId()
  return (
    <svg data-testid="logo" role="img" aria-label="Achmage Yogurt" width={size} height={size} viewBox="0 0 100 100" className={`shrink-0 ${className}`}>
      <defs><mask id={mask}><path fill="white" d="M0 0H100V100H0Z"/><path fill="black" stroke="black" strokeWidth="3" d="M6.5 62.5C28 72 55.5 55.5 89 31L84.5 47C59 68 27 84 8 74Z"/></mask></defs>
      <path fill="currentColor" mask={`url(#${mask})`} d="M49.8 6.5 16 73 33 67 50.8 30 67 65 84.5 72Z"/><path fill="currentColor" d="M83 10 86 19 95 22 86 25 83 34 80 25 71 22 80 19Z"/>
      <path fill="#00a8a3" d="M6.5 62.5C28 72 55.5 55.5 89 31L84.5 47C59 68 27 84 8 74Z"/>
    </svg>
  )
}

/** The mark with the name next to it, as on the website. Sized by its height. */
export function Wordmark({ height = 32 }: { height?: number }) {
  return (
    <span data-testid="wordmark" role="img" aria-label="Achmage Yogurt" className="achmage-wordmark" style={{display:'inline-flex',alignItems:'center',gap:8,color:'var(--ink)'}}>
      <svg height={height} width={height*1574/547} viewBox={wordmark.viewBox} aria-hidden="true"><path fill="currentColor" d={wordmark.inkPath} fillRule="evenodd"/><path fill="currentColor" d={wordmark.flowPath} fillRule="evenodd"/><path fill="#00a8a3" d={wordmark.arcPath} fillRule="evenodd"/></svg><span style={{fontSize:height*.66,fontWeight:650}}>Yogurt</span>
    </span>
  )
}
