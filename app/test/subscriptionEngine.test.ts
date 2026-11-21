import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSubscription, subscriptionArgs, subscriptionEnv } from '../src/main/subscriptionEngine'

const dirs: string[] = []
const cwd = () => { const d = mkdtempSync(join(tmpdir(), 'yogurt-sub-test-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const request = [{ role: 'user' as const, content: '시험 회의 전사' }]
const fixture = (code: string) => ({ binary: process.execPath, args: ['-e', code] })

describe('official subscription client bridge', () => {
  it('passes an explicit long-record output budget to Claude', async () => {
    const command = fixture(`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',result:process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,is_error:false})));`)
    await expect(runSubscription('claude-sonnet-5-5', request, cwd(), () => {}, undefined, command, 16000)).resolves.toBe('16000')
  })
  it('rejects a token-limited result even if the client subsequently reports success', async () => {
    const command = fixture(`process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'max_tokens'}}}));console.log(JSON.stringify({type:'result',result:'truncated',is_error:false}));});`)
    await expect(runSubscription('claude-sonnet-5-5', request, cwd(), () => {}, undefined, command)).rejects.toThrow('출력 한도')
  })
  it('streams Claude text deltas and returns the authoritative completed response', async () => {
    const got: string[] = []
    const command = fixture(`process.stdin.resume();process.stdin.on('end',()=>{for(const text of ['회의 ','요약'])console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text}}}));console.log(JSON.stringify({type:'result',result:'회의 요약',is_error:false}));});`)
    await expect(runSubscription('claude-sonnet-5-5', request, cwd(), s => got.push(s), undefined, command)).resolves.toBe('회의 요약')
    expect(got.join('')).toBe('회의 요약')
  })
  it('surfaces a rejected target instead of returning partial text or choosing another model', async () => {
    const command = fixture(`process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'turn.failed',error:{message:'model_not_found: not supported'}}));process.exitCode=1;});`)
    await expect(runSubscription('gpt-6.2-sol', request, cwd(), () => {}, undefined, command)).rejects.toThrow('현재 구독 계정에서 이 모델을 사용할 수 없습니다')
  })
  it('cancels the actual child while waiting for output without returning an incomplete summary', async () => {
    const abort = new AbortController()
    const command = fixture(`process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'partial'}}}));setInterval(()=>{},1000);});`)
    await expect(runSubscription('claude-sonnet-5-5', request, cwd(), () => abort.abort(), abort.signal, command)).rejects.toThrow('Stopped')
  })
  it('rejects empty success rather than saving a blank note', async () => {
    const command = fixture(`process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'result',result:'',is_error:false})));`)
    await expect(runSubscription('claude-sonnet-5-5', request, cwd(), () => {}, undefined, command)).rejects.toThrow('빈 응답')
  })
  it('uses exact requested models, disables tools and excludes API-key overrides', () => {
    expect(subscriptionArgs('claude-sonnet-5-5')).toContain('claude-sonnet-5-5')
    expect(subscriptionArgs('claude-sonnet-5-5')).toContain('--safe-mode')
    expect(subscriptionArgs('gpt-6.2-sol')).toContain('gpt-6.2-sol')
    expect(subscriptionArgs('gpt-6.2-sol')).toContain('features.shell_tool=false')
    const previous = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_BASE_URL: process.env.OPENAI_BASE_URL }
    process.env.ANTHROPIC_API_KEY = 'test-only'; process.env.OPENAI_API_KEY = 'test-only'; process.env.OPENAI_BASE_URL = 'https://example.invalid'
    const env = subscriptionEnv()
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    expect(env.ANTHROPIC_API_KEY).toBeUndefined(); expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.OPENAI_BASE_URL).toBeUndefined()
  })
})
