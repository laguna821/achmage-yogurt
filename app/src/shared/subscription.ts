export const SUBSCRIPTION_MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'claude' },
  { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', provider: 'codex' },
] as const
export type SubscriptionModel = typeof SUBSCRIPTION_MODELS[number]['id']
export const subscriptionModel = (v: unknown): SubscriptionModel => v === 'gpt-6.2-sol' ? v : 'claude-sonnet-5-5'
export type SubscriptionStatus = {
  model: SubscriptionModel
  claude: { installed: boolean; loggedIn: boolean; label: string }
  codex: { installed: boolean; loggedIn: boolean; label: string }
  localModelBytes: number
}
export type SubscriptionCheck = { ok: boolean; message: string }
