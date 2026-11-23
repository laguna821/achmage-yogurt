import { browserSubscriptionLogin } from './subscriptionLogin'
import { ipcMain } from 'electron'
import { join } from 'node:path'
import { existsSync, lstatSync, rmSync } from 'node:fs'
import { loadSettings, updateSettings } from './settings'
import { runSubscription, subscriptionLogin } from './subscriptionEngine'
import { SUBSCRIPTION_MODELS, subscriptionModel, reasoningEffort, type SubscriptionCheck, type SubscriptionModel } from '../shared/subscription'
import { subscriptionMetadata } from './subscriptionMetadata'

/** Only downloaded AI weights. No database, transcript or recording is in this list. */
export function localAiFiles(profile: string) {
  return ['llm/gemma-4-E4B_q4_0-it.gguf', 'embed/embeddinggemma-300M-Q8_0.gguf'].flatMap(p => ['', '.ok', '.part'].map(s => join(profile, 'models', p + s)))
}
export const localAiBytes = (profile: string) => localAiFiles(profile).reduce((n, f) => n + (existsSync(f) && lstatSync(f).isFile() ? lstatSync(f).size : 0), 0)

export function hookSubscriptionSettings(profile: string, busy: () => boolean) {
  const file = join(profile, 'settings.json'), cwd = join(profile, 'subscription-runtime')
  ipcMain.handle('subscription:connect', () => browserSubscriptionLogin())
  ipcMain.handle('subscription:status', async () => {
    const [claude, codex, metadata] = await Promise.all([subscriptionLogin('claude', cwd), subscriptionLogin('codex', cwd), subscriptionMetadata()])
    return { model: subscriptionModel(loadSettings(file).aiModel), effort: reasoningEffort(loadSettings(file).aiReasoningEffort), claude, codex, ...metadata, localModelBytes: localAiBytes(profile) }
  })
  ipcMain.handle('subscription:apply', async (_e, choice: unknown, effort: unknown): Promise<SubscriptionCheck> => {
    if (!SUBSCRIPTION_MODELS.some(m => m.id === choice)) return { ok: false, message: '지원하지 않는 모델입니다.' }
    if (busy()) return { ok: false, message: '현재 요약이나 답변이 끝난 뒤 모델을 변경하세요.' }
    const model = choice as SubscriptionModel
    const login = await subscriptionLogin(model === 'claude-sonnet-5-5' ? 'claude' : 'codex', cwd)
    if (!login.loggedIn) return { ok: false, message: login.label }
    updateSettings(file, { aiModel: model, aiReasoningEffort: reasoningEffort(effort), autoUpdate: false })
    return { ok: true, message: `${SUBSCRIPTION_MODELS.find(m => m.id === model)!.name} · ${reasoningEffort(effort)} 저장 완료. 모델 호출은 하지 않았습니다.` }
  })
  ipcMain.handle('subscription:test', async (): Promise<SubscriptionCheck> => {
    if (busy()) return { ok: false, message: '현재 작업이 끝난 뒤 연결을 시험하세요.' }
    const settings = loadSettings(file), model = subscriptionModel(settings.aiModel)
    try {
      const result = await runSubscription(model, [{ role: 'user', content: 'Reply with exactly YOGURT_CONNECTION_OK and nothing else.' }], cwd, () => {}, AbortSignal.timeout(90_000), undefined, 4096, reasoningEffort(settings.aiReasoningEffort))
      if (!result.includes('YOGURT_CONNECTION_OK')) return { ok: false, message: '모델 연결 응답을 확인하지 못했습니다. 기존 설정을 유지합니다.' }
      return { ok: true, message: `${SUBSCRIPTION_MODELS.find(m => m.id === model)!.name} 연결 확인 및 적용 완료` }
    } catch (e) { return { ok: false, message: e instanceof Error ? e.message : '연결을 확인하지 못했습니다.' } }
  })
  ipcMain.handle('subscription:remove-local', () => {
    if (busy()) throw new Error('요약이나 답변이 끝난 뒤 다시 시도하세요.')
    const bytes = localAiBytes(profile)
    for (const dir of ['llm', 'embed']) {
      const p = join(profile, 'models', dir)
      if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error('외부 연결 폴더는 자동 정리하지 않습니다.')
    }
    for (const f of localAiFiles(profile)) rmSync(f, { force: true })
    return bytes
  })
}
