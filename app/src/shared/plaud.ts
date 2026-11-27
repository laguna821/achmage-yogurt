export type PlaudStatus = { connected: boolean; connecting: boolean; message: string; downloading?: { id: string; bytes: number; total?: number } }
export type PlaudRecording = { id: string; name: string; createdAt: string; durationMs: number; jobId?: string; meetingId?: string }
export type PlaudImportOptions = { mode: 'transcript' | 'local'; keepAudio?: boolean }
export type PlaudAPI = {
  status(): Promise<PlaudStatus>
  connect(): Promise<PlaudStatus>
  disconnect(): Promise<PlaudStatus>
  list(page: number): Promise<PlaudRecording[]>
  import(id: string, options?: PlaudImportOptions): Promise<import('./imports').ImportJob>
  cancel(): Promise<void>
}
