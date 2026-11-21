export type RecordKind = 'auto' | 'meeting' | 'lecture' | 'colloquium' | 'seminar' | 'conversation' | 'other' | 'own-lecture' | 'interview'
export type RecordProfile = 'record' | 'minutes'
export type OrganizerOptions = { kind: RecordKind; profile: RecordProfile; vault: boolean; mail: boolean; web: boolean }
export const defaultOrganizerOptions: OrganizerOptions = { kind: 'auto', profile: 'record', vault: true, mail: true, web: true }
export type EvidenceProvider = 'transcript' | 'attached' | 'vault' | 'mail' | 'web' | 'user'
export type Evidence = { id: string; provider: EvidenceProvider; title: string; locator: string; text: string; revision?: string; issueIds: string[]; imagePath?: string }
export type RecordIssue = { id: string; category: 'speaker' | 'term' | 'date' | 'number' | 'privacy'; question: string; context: string; query: string; publicEntity?: string }
export type RecordFinding = { issueId: string; original: string; value: string; confidence: 'confirmed' | 'likely' | 'unresolved'; basis: string; sourceIds: string[] }
export type RecordSpeaker = { label: string; name: string; confidence: 'confirmed' | 'likely' | 'unresolved'; basis: string; sourceIds: string[]; scope: string; clueTypes?: string[] }
export type RecordQuestion = { id: string; issueId: string; question: string; options: string[]; defaultAnswer: string; basis: string; answer?: string }
export type ConnectorStatus = { provider: 'vault' | 'mail' | 'web'; connected: boolean; detail: string }
export type OrganizerContext = { notes: string; participants: string; links: string }
export type OrganizerState = {
  context: OrganizerContext
  meetingId: string; runId?: string; revision: number; options: OrganizerOptions
  phase: 'idle' | 'preparing' | 'researching' | 'matching' | 'drafting' | 'checking' | 'questions' | 'ready' | 'failed' | 'interrupted'
  message: string; kind?: RecordKind; startedAt?: number; finishedAt?: number
  sourceHash?: string; evidence: Evidence[]; issues: RecordIssue[]; findings: RecordFinding[]; speakers: RecordSpeaker[]; questions: RecordQuestion[]
  connectors: ConnectorStatus[]; checks: string[]; error?: string; draftHash?: string
}
