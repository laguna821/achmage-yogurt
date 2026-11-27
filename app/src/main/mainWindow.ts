import type { BrowserWindow } from 'electron'

/**
 * Native close defaults to graceful quit on Windows/Linux. Background mode keeps noticing calls.
 * Windows and Linux without a tray icon (turned off, or GNOME without its extension) minimise instead,
 * so Yogurt never keeps running out of sight.
 */
export type CloseBehavior = 'quit' | 'background'
export const defaultCloseBehavior = (os: string): CloseBehavior => os === 'darwin' ? 'background' : 'quit'
export const closeAction = (os: string, trayShown: boolean, behavior: CloseBehavior = defaultCloseBehavior(os)): 'quit' | 'hide' | 'minimize' =>
  behavior === 'quit' ? 'quit' : os === 'darwin' || trayShown ? 'hide' : 'minimize'

/** Closing keeps the renderer alive; only the completed save/quit path may destroy it. */
export function keepMainWindow(window: BrowserWindow, d: { background: boolean; canClose(): boolean; activate(): void; requestQuit?(): void; closeTo?(): 'quit' | 'hide' | 'minimize'; glass?: boolean
  /** a Mac: floats the window for a moment when brought forward, see show() */
  lift?: boolean }) {
  let ready = false, requested = false, foreground = false
  const show = (bringForward = false) => {
    if (d.background || window.isDestroyed()) return
    requested = true; foreground ||= bringForward
    if (!ready) return
    requested = false
    if (window.isMinimized()) window.restore()
    // macOS may refuse to switch apps (the pill is a non-activating panel, Safari stays active); the window then
    // landed behind Safari, out of sight. Floating it for the show puts it on top either way.
    const lift = foreground && d.lift === true
    if (lift) window.setAlwaysOnTop(true)
    window.show()
    if (foreground) { window.moveTop(); d.activate() }
    window.focus()
    if (lift) window.setAlwaysOnTop(false)
    foreground = false
  }
  window.once('ready-to-show', () => {
    ready = true
    // The theme-matched startup fill is no longer needed; restore the existing native glass.
    if (d.glass !== false) window.setBackgroundColor('#00000000')
    if (requested) show()
  })
  window.on('close', (event) => {
    if (d.canClose()) return
    event.preventDefault()
    requested = false; foreground = false
    const action = d.closeTo?.()
    if (action === 'quit') d.requestQuit?.()
    else if (action === 'minimize') window.minimize()
    else window.hide()
  })
  return show
}
