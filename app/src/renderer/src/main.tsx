import { installScrollActivity } from './scrollActivity'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './workspace.css'
import './setup.css'
import './achmage.css'
import { paletteOf, paletteTokens, type Appearance } from '../../shared/appearance'
import { App } from './App'
import { Prompt } from './windows/Prompt'
import { Widget } from './windows/Widget'
import { applyLanguage, useLanguage } from './i18n'

// The small prompt card and the recording widget are the same page with #prompt and #widget
const Which = location.hash === '#prompt' ? Prompt : location.hash === '#widget' ? Widget : App
document.documentElement.classList.toggle('main-window', Which === App)
// Windows and Linux: the system's window buttons over the top right, no traffic lights (workspace.css)
if (window.yogurt.platform !== 'darwin') document.documentElement.dataset.chrome = 'overlay'
if (Which === App) installScrollActivity(document)
// everything re-renders in a newly picked language, in every window at once
function Page() { useLanguage(); return <Which /> }
const render = () => createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>)
const applyAppearance = (s: Appearance) => { const root = document.documentElement; root.dataset.skin = s[s.resolved]; root.dataset.mode = s.resolved; root.style.colorScheme = s.resolved; for (const [key, value] of Object.entries(paletteTokens(paletteOf(s[s.resolved], s.resolved)))) root.style.setProperty(key, value) }
window.yogurt.appearance.onChange(applyAppearance)
window.yogurt.settings.onLanguage(applyLanguage)
// the interface language first, so no window flashes English (or the wrong direction)
Promise.all([window.yogurt.settings.get().then((s) => applyLanguage(s.locale), () => {}), window.yogurt.appearance.get().then(applyAppearance, () => {})]).finally(render)
