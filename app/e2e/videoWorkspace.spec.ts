import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { defaultVideoOptions } from '../src/shared/video'
test('video evidence images, prep, topic research, exact MD export and restart', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'achmage-video-e2e-')), transcript = join(profile, 'source.srt'), zipPath = join(profile, 'video.zip')
  writeFileSync(transcript, '1\n00:00:00,000 --> 00:00:10,000\n상관관계를 인과관계로 단정하면 안 됩니다.\n')
  const launch = () => electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js'), '--ozone-platform=x11'], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: profile, YOGURT_BACKGROUND: '1', YOGURT_SYSTEM_LANGUAGES: 'ko-KR', YOGURT_EXPORT_PATH: zipPath } })
  let app = await launch()
  try {
    let page = await app.firstWindow(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    await expect(page.getByTestId('home')).toBeVisible()
    const job = await page.evaluate(path => window.yogurt.imports.start({ paths: [path] }), transcript)
    await expect.poll(async () => (await page.evaluate(() => window.yogurt.imports.list()))[0].stage).toBe('done')
    const id = (await page.evaluate(() => window.yogurt.imports.list())).find(j => j.id === job.id)!.meetingId!, dir = join(profile, 'meetings', id, 'video'), file = 'frame-1234567890abcdef.jpg'
    mkdirSync(join(dir, 'frames'), { recursive: true })
    execFileSync(join(import.meta.dirname, '../resources/tools/ffmpeg'), ['-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=640x360:d=1', '-frames:v', '1', join(dir, 'frames', file)])
    const sha = createHash('sha256').update(readFileSync(join(dir, 'frames', file))).digest('hex')
    const md = `# 영상 정리\n\n## 01. 상관과 인과\n\n**인과로 단정하지 않습니다.**\n\n![화면 질문](assets/${file})\n\n[1:31 원본](https://www.youtube.com/watch?v=abcdefghijk&t=91s)\n`
    writeFileSync(join(dir, 'assets.json'), JSON.stringify({ [file]: sha }))
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ schemaVersion: 1, meetingId: id, phase: 'ready', message: '영상 정리본이 준비됐습니다.', options: defaultVideoOptions, metadata: { url: 'https://www.youtube.com/watch?v=abcdefghijk', videoId: 'abcdefghijk', title: '한글 강의', durationMs: 120000, startMs: 90000, endMs: 120000, transcriptSource: '로컬 Whisper' }, frames: [{ id: 'V91000', atMs: 91000, file, sha256: sha, kind: 'question', text: 'Q. 인과관계인가요?', description: '화면에만 표시된 질문', score: 10 }], document: { keyPoints: [{ text: '인과로 단정하지 않습니다.', refs: ['T1'] }], topics: [{ id: 'topic-0-1', title: '상관과 인과', paragraphs: [{ text: '인과로 단정하지 않습니다.', refs: ['T1'] }], frameIds: ['V91000'] }], questions: [{ id: 'Q1', question: '이 용어의 맥락이 맞나요?' }] }, research: [{ id: 'read-1', topic: '인과관계', phase: 'ready', message: '실제 읽은 자료 1건', queries: ['인과 연구 한계'], sources: [{ id: 'R1', url: 'https://example.org/paper', title: '읽은 논문', text: '본문', sha256: 'hash', accessedAt: '2026-11-24' }], markdown: '# 추가 조사\n\n[읽은 논문](https://example.org/paper)\n', createdAt: 1 }], warnings: [], checks: [], sampledCount: 30, candidateCount: 2, aiCalls: 4, updatedAt: Date.now() }))
    await page.evaluate(async ({ id, md }) => { await window.yogurt.notes.setEnhanced(id, md, 1); window.yogurt.nav.go('/note/' + id) }, { id, md })
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await expect(page.getByTestId('video-workspace')).toBeVisible()
    await page.getByRole('button', { name: '읽기', exact: true }).click()
    const image = page.getByTestId('note-enhanced-editor').locator('img')
    await expect(image).toBeVisible(); await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(640)
    expect(await app.evaluate(async ({net},id) => (await net.fetch(`yogurt-video://${id}/../secret`)).status, id)).toBe(404)
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1024,680))
    await page.getByTestId('video-prepare').click(); await expect(page.getByTestId('video-prep')).toBeVisible()
    await expect(page.getByTestId('video-prep')).toHaveCSS('opacity','1')
    const metrics=await page.getByTestId('video-prep').evaluate(el=>({height:el.getBoundingClientRect().height,viewport:innerHeight,max:getComputedStyle(el).maxHeight,transform:getComputedStyle(el).transform}))
    console.log('VIDEO_DIALOG_METRICS='+JSON.stringify(metrics));expect(metrics.height).toBeLessThan(metrics.viewport-16)
    await page.getByTestId('video-prep').getByRole('button', { name: '닫기', exact: true }).click()
    await page.getByTestId('video-workspace').getByText('추가 조사',{exact:true}).click()
    await page.getByRole('button', { name: '인과관계', exact: true }).click(); await expect(page.getByTestId('video-research-result')).toContainText('읽은 논문'); await page.getByTestId('video-research-dialog').getByRole('button', { name: '닫기', exact: true }).click()
    await page.getByPlaceholder('아는 만큼 입력하세요. 모르면 미확인으로 남깁니다.').fill('수업에서 논의한 맥락입니다.')
    await page.getByRole('button', { name: '확인 답변 저장', exact: true }).click(); await expect.poll(async () => (await page.evaluate(id => window.yogurt.video.get(id), id))?.document?.questions[0].answer).toBe('수업에서 논의한 맥락입니다.')
    await page.getByTestId('video-copy').click(); await expect(page.getByTestId('video-workspace')).toContainText('Markdown 원문을 복사했습니다.')
    await page.getByTestId('video-export-assets').click(); await expect.poll(() => { try { return readFileSync(zipPath).length } catch { return 0 } }).toBeGreaterThan(500)
    await page.screenshot({ path: join(profile, 'video-workspace.png'), fullPage: true })
    expect((await page.evaluate(id => window.yogurt.notes.get(id), id)).enhanced).toBe(md); expect(errors).toEqual([])
    await page.evaluate(()=>window.yogurt.nav.go('/meetings'));await expect(page.getByTestId('home')).toBeVisible()
    const state=await page.evaluate(id=>window.yogurt.video.get(id),id)
    await app.evaluate(({BrowserWindow},state)=>BrowserWindow.getAllWindows()[0].webContents.send('video:changed',{...state,phase:'reading',message:'화면 자료를 판독하고 있습니다.'}),state)
    await expect(page.getByTestId('video-import-progress')).toContainText('화면 자료를 판독하고 있습니다.')
    await page.getByTestId('video-import-progress').getByRole('button',{name:'진행·결과 열기'}).click();await expect(page.getByTestId('video-workspace')).toBeVisible()
    await app.close(); app = await launch(); page = await app.firstWindow(); await page.waitForFunction(() => !!window.yogurt)
    expect((await page.evaluate(id => window.yogurt.video.get(id), id))?.document?.questions[0].answer).toBe('수업에서 논의한 맥락입니다.')
    console.log('VIDEO_E2E_PROFILE=' + profile)
  } finally { await app.close() }
})
