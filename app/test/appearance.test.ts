import{describe,it,expect}from'vitest'
import{PALETTES,paletteOf,paletteTokens}from'../src/shared/appearance'
describe('appearance data contract',()=>{
 it('provides all reference palettes with opaque, readable primary text and buttons',()=>{
  expect(PALETTES).toHaveLength(27);expect(new Set(PALETTES.map(p=>p.id)).size).toBe(27)
  const luminance=(hex:string)=>[1,3,5].map(n=>parseInt(hex.slice(n,n+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)
  const ratio=(a:string,b:string)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
  for(const p of PALETTES){const t=paletteTokens(p);expect(t['--bg'],p.name).toMatch(/^#[0-9a-f]{6}$/i);expect(ratio(t['--bg'],t['--ink']),p.name+' body').toBeGreaterThanOrEqual(4.5);expect(ratio(t['--accent'],t['--accent-ink']),p.name+' button').toBeGreaterThanOrEqual(4.5)}
 })
 it('resolves unknown selections within the selected light/dark mode',()=>{expect(paletteOf('missing','dark').mode).toBe('dark');expect(paletteOf('missing','light').mode).toBe('light')})
})
