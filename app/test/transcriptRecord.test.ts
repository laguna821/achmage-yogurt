import { describe, expect, it } from 'vitest'
import { cleanRecord, writeTranscriptRecord } from '../src/main/notes/transcriptRecord'
import { enhance, type Llm, type PromptInput } from '../src/main/notes/enhance'
import type { Segment } from '../src/main/store'

const source: PromptInput = { title: '교수회의', attendees: [{ name: '김 교수', email: null }], mine: '', language: 'Korean', oneMic: true,
  transcript: '[0:00] [channel=me; label=me] 워크숍은 12월 18일을 제안했다.\n[45:00] [channel=me; label=me] 아직 결정하지 않았다. 마지막에는 peer review 사례를 설명했다.' }
const draft = '## 개요\n\n워크숍 운영을 검토했다.\n\n## 워크숍 날짜\n\n12월 18일이 제안되었으나 아직 결정되지 않았다.'
const final = draft + '\n\n## 동료 평가 사례\n\n마지막에 peer review 사례를 설명했다.'

describe('Achmage transcript record', () => {
  it('checks the original tail independently and only streams the checked pass', async () => {
    const calls: string[] = [], streamed: string[] = [], stages: string[] = []
    const llm: Llm = { contextSize: 131_072, count: async xs => xs.map(x => x.length), chat: async (p, token, opts) => {
      calls.push(p)
      expect(opts?.maxTokens).toBeGreaterThanOrEqual(8_000)
      const answer = ['일정은 제안이며 미정. 화자 신원은 미확정. 끝부분에 동료 평가 사례가 있음.', draft, final][calls.length - 1]
      token(answer); return answer
    } }
    expect(await writeTranscriptRecord(source, llm, text => streamed.push(text), stage => stages.push(stage))).toBe(final)
    expect(stages).toEqual(['analyzing', 'drafting', 'checking'])
    expect(calls).toHaveLength(3)
    for (const prompt of calls) expect(prompt).toContain('마지막에는 peer review 사례를 설명했다')
    expect(calls[2]).toContain(JSON.stringify(draft))
    expect(streamed).toEqual([final])
  })
  it('preserves final prose, task tables and complete Mermaid blocks', () => {
    const md = '## 개요\n\n본문이다.\n\n| 과제 | 담당 | 기한 |\n| --- | --- | --- |\n| 검토 | 미정 | 미정 |\n\n```mermaid\nflowchart LR\nA["검토"] --> B["보완"]\n```\n\n## 확인이 필요한 사항\n\n마지막 수치는 아직 확인되지 않았다.'
    expect(cleanRecord('설명합니다.\n' + md)).toBe(md)
    expect(cleanRecord('```markdown\n' + md + '\n```')).toBe(md)
    expect(() => cleanRecord(md + '\n```mermaid\nflowchart LR')).toThrow('도식이 끝나지')
  })
  it('rejects over-context source rather than silently summarizing or cutting it', async () => {
    let calls = 0
    const llm: Llm = { contextSize: 100, count: async xs => xs.map(x => x.length), chat: async () => { calls++; return final } }
    await expect(writeTranscriptRecord(source, llm, () => {})).rejects.toThrow('입력이 너무 깁니다')
    expect(calls).toBe(0)
  })
  it('uses original timed channel evidence, never old compact parts or fuzzy name substitutions', async () => {
    const prompts: string[] = []
    const llm: Llm = { recordMode: true, contextSize: 131_072, count: async xs => xs.map(x => x.length), chat: async p => { prompts.push(p); return prompts.length === 1 ? '확인 대기' : final } }
    const segments: Segment[] = [{ id: 1, meetingId: 'm', track: 'me', startMs: 60_000, endMs: 61_000, speaker: 'me', text: '김 서현 교수의 발언은 불확실하다.' }]
    const result = await enhance({ meeting: { title: '교수회의', attendees: source.attendees }, mine: '', segments, language: 'ko' }, llm, () => {}, undefined, [{ lines: ['anything'], summary: 'LOSSY OLD SUMMARY' }])
    expect(result).toBe(final)
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      expect(prompt).toContain('[1:00] [channel=me; label=me] 김 서현 교수')
      expect(prompt).not.toContain('LOSSY OLD SUMMARY')
    }
  })
})
