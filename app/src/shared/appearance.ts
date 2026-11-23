import palettes from './palettes.json'

export type Palette = { id: string; name: string; mode: 'light' | 'dark'; colors: Record<string, string> }
export const PALETTES = palettes as Palette[]
export type Appearance = { light: string; dark: string; favorites: string[]; mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }
export const DEFAULT_APPEARANCE = { light: 'achmage-workbench', dark: 'atlas-graphite' }
export function paletteOf(id: string, mode: 'light' | 'dark'): Palette {
  return PALETTES.find(p => p.id === id && p.mode === mode) ?? PALETTES.find(p => p.id === DEFAULT_APPEARANCE[mode])!
}
export function paletteTokens(p: Palette): Record<string, string> {
  const c = p.colors, dark = p.mode === 'dark'
  const solid = (hex: string | undefined, base = dark ? '#161618' : '#ffffff') => {
    if (!hex || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return base
    if (hex.length === 7) return hex
    const a = parseInt(hex.slice(7), 16) / 255
    return '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * a + parseInt(base.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('')
  }
  const bg = solid(c.background), panel = solid(c['secondary.background'], bg), ink = c.foreground
  const contrast = (a: string, b: string) => {
    const lum = (s: string) => [1,3,5].map(i => parseInt(s.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((v,x,i) => v+x*[.2126,.7152,.0722][i],0)
    const x=lum(solid(a)), y=lum(solid(b)); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)
  }
  const accent = c['accent.background'], onAccent = contrast('#ffffff', accent) >= contrast('#000000', accent) ? '#ffffff' : '#000000'
  // Several source palettes use low contrast muted inks. Preserve the palette while keeping app copy readable.
  const muted = contrast(c['muted.foreground'], bg) >= 4.5 ? c['muted.foreground'] : ink
  const link = contrast(c.link || accent, bg) >= 4.5 ? c.link || accent : ink
  return {
    '--bg':bg, '--card':panel, '--float':solid(c['popover.background'],bg), '--chrome':solid(c['title_bar.background'],bg),
    '--ink':ink, '--heading':ink, '--written':ink, '--muted':muted, '--line':solid(c.border,bg),
    '--accent':accent, '--accent-ink':onAccent, '--accent-soft':solid(c['selection.background'],bg),
    '--primary':accent, '--primary-hover':c['primary.hover.background'] || accent,
    '--control':panel, '--control-hover':solid(c['secondary.hover.background'],bg), '--control-pressed':solid(c['secondary.active.background'],bg),
    '--control-border':solid(c['input.border'],bg), '--selected':solid(c['list.active.background'],bg), '--focus':link, '--skin-link':link,
    '--skin-sidebar-field':solid(c['sidebar.accent.background'],solid(c['sidebar.background'],bg)), '--skin-sidebar-selected':solid(c['sidebar.accent.background'],solid(c['sidebar.background'],bg)),
    '--skin-sidebar':solid(c['sidebar.background'],bg), '--skin-sidebar-ink':c['sidebar.foreground'] || ink,
    '--playback-bg':solid(c['selection.background'],bg), '--playback-ink':ink,
    '--danger':c['danger.background'] || '#c13e51', '--danger-ink':c['danger.foreground'] || '#fff',
    '--status-live':c['success.background'] || (dark ? '#a3d9b1' : '#237341'),
    '--pill':panel, '--pill-ink':ink, '--pill-accent':accent, '--widget-line':solid(c.border,bg),
    '--scrim':dark ? '#00000099' : '#00000040', '--shadow':dark ? '0 16px 44px #00000066' : '0 16px 44px #00000022',
  }
}
