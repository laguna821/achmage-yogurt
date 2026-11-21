export const SUBSCRIPTION_MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', provider: 'claude' },
  { id: 'gpt-6.2-sol', name: 'GPT-6.2 Sol', provider: 'codex' },
  { id: 'gpt-6.2-astra', name: 'GPT-6.2 Astra', provider: 'codex' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', provider: 'codex' },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', provider: 'codex' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'codex' },
  { id: 'gpt-6-sol', name: 'GPT-6 Sol', provider: 'codex' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', provider: 'codex' },
] as const
export type SubscriptionModel = typeof SUBSCRIPTION_MODELS[number]['id']
export const subscriptionModel = (v: unknown): SubscriptionModel => SUBSCRIPTION_MODELS.some(m => m.id === v) ? v as SubscriptionModel : 'gpt-6.2-sol'
export const REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningEffort = typeof REASONING_EFFORTS[number]
export const reasoningEffort = (v: unknown): ReasoningEffort => REASONING_EFFORTS.includes(v as ReasoningEffort) ? v as ReasoningEffort : 'xhigh'
export type SubscriptionStatus = {
  model: SubscriptionModel
  effort: ReasoningEffort
  claude: { installed: boolean; loggedIn: boolean; label: string }
  codex: { installed: boolean; loggedIn: boolean; label: string }
  codexModels?: { id: string; efforts: string[] }[]
  codexPlan?: string
  localModelBytes: number
}
export type SubscriptionCheck = { ok: boolean; message: string }
