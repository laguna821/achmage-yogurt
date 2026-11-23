import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { DEFAULT_APPEARANCE, PALETTES, paletteOf, paletteTokens, type Appearance } from '../shared/appearance'
import { loadSettings, updateSettings } from './settings'

export function hookAppearance(file: string) {
  const get = (): Appearance => {
    const s=loadSettings(file), saved=s.appearance
    return { light:paletteOf(saved?.light || DEFAULT_APPEARANCE.light,'light').id, dark:paletteOf(saved?.dark || DEFAULT_APPEARANCE.dark,'dark').id,
      favorites:(saved?.favorites || []).filter(id=>PALETTES.some(p=>p.id===id)), mode:s.theme || 'system', resolved:nativeTheme.shouldUseDarkColors?'dark':'light' }
  }
  const send = () => {
    const state=get(), tokens=paletteTokens(paletteOf(state[state.resolved],state.resolved))
    for(const w of BrowserWindow.getAllWindows()) if(!w.isDestroyed()) {
      w.webContents.send('appearance:changed',state)
      if(process.platform!=='darwin' && w.getTitle().includes('Yogurt')) {
        try { w.setTitleBarOverlay({color:tokens['--chrome'],symbolColor:tokens['--ink'],height:52}) } catch { /* floating windows have no title overlay */ }
      }
    }
    return state
  }
  ipcMain.handle('appearance:get',get)
  ipcMain.handle('appearance:set',(_e,raw:unknown)=>{
    if(!raw || typeof raw!=='object') throw new Error('스킨 설정을 확인하세요.')
    const v=raw as Partial<Appearance>, before=get()
    const next={light:paletteOf(v.light || before.light,'light').id,dark:paletteOf(v.dark || before.dark,'dark').id,
      favorites:Array.isArray(v.favorites)?v.favorites.filter(id=>PALETTES.some(p=>p.id===id)).slice(0,27):before.favorites}
    updateSettings(file,{appearance:next,...(v.mode && ['light','dark','system'].includes(v.mode)?{theme:v.mode==='system'?undefined:v.mode}: {})})
    if(v.mode && ['light','dark','system'].includes(v.mode)) nativeTheme.themeSource=v.mode
    return send()
  })
  nativeTheme.on('updated',send)
}
