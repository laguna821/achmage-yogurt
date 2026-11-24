import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

test('legacy video category opens the video organizer before provenance exists and survives completion', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'achmage-video-legacy-')), db = new DatabaseSync(join(profile, 'yogurt.db'))
  // Start with the old baseline schema; the production app performs its real migrations on launch.
  db.exec(`CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, event_id TEXT, app TEXT, attendees TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL, language TEXT);
    CREATE TABLE segments (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL, track TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, text TEXT NOT NULL, speaker TEXT);
    CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_id TEXT NOT NULL UNIQUE, mine TEXT NOT NULL DEFAULT '', enhanced TEXT, edited INTEGER NOT NULL DEFAULT 0);`)
  const title = "울 때마다 쥐여준 스마트폰, 그 아이들이 16살이 됐습니다 | '불안 세대' 저자가 부모에게 전하는 경고 [더 프롬프트 EP.2]"
  const video = { id: randomUUID() }, recording = { id: randomUUID() }
  for (const [id, name, at] of [[video.id, title, Date.now()], [recording.id, '보존할 회의 기록', Date.now() - 1000]] as const) db.prepare("INSERT INTO meetings (id,title,started_at,ended_at,state) VALUES (?,?,?,?,'stopped')").run(id,name,at,at)
  db.prepare('INSERT INTO notes (meeting_id,enhanced,edited) VALUES (?,?,1)').run(recording.id,'# 회의 편집 원문'); db.close()
  mkdirSync(join(profile, 'imports')); mkdirSync(join(profile, 'meetings', video.id, 'original'), { recursive: true })
  const job = { id: 'bfadcccf-96f5-4b88-b965-2a7c735e2654', meetingId: video.id, title, files: [], url: 'https://www.youtube.com/watch?v=ADP3Wo47m6E', caption: true, stage: 'transcribing', message: '로컬 전사 중', createdAt: Date.now(), updatedAt: Date.now() }
  const saveJob = () => writeFileSync(join(profile, 'imports', job.id + '.json'), JSON.stringify(job))
  saveJob()
  // The user's real case: metadata exists, import-source/state do not, and transcription is unfinished.
  writeFileSync(join(profile, 'meetings', video.id, 'original/youtube.info.json'), JSON.stringify({ title, duration: 1314, channel: 'YTN다큐' }))
  const launch = () => electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js'), '--ozone-platform=x11'], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: profile, YOGURT_BACKGROUND: '1', YOGURT_SYSTEM_LANGUAGES: 'ko-KR' } })
  let app = await launch()
  try {
    let page = await app.firstWindow(); await expect(page.getByTestId('home')).toBeVisible()
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    await page.getByTestId('nav-videos').click()
    await expect(page.getByTestId('nav-videos')).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('h1', { hasText: 'YouTube 영상' })).toBeVisible()
    await expect(page.locator(`[data-meeting-id="${video.id}"]`)).toBeVisible()
    await expect(page.locator(`[data-meeting-id="${recording.id}"]`)).toHaveCount(0)
    await page.locator(`[data-meeting-id="${video.id}"]`).click()
    await expect(page.getByTestId('video-workspace')).toBeVisible()
    await expect(page.getByTestId('video-prepare')).toHaveText('이 영상 정리하기')
    await expect(page.getByTestId('note-resume')).toHaveCount(0)
    await expect(page.getByTestId('video-import-retry')).toBeVisible()
    await expect(page.getByTestId('nav-videos')).toHaveAttribute('aria-current', 'page')
    await page.getByTestId('video-prepare').click()
    await expect(page.getByTestId('video-start')).toBeDisabled()
    await page.getByTestId('video-prep').getByRole('button', { name: '닫기', exact: true }).click()
    const error = await page.evaluate(id => window.yogurt.video.start(id, {}).then(() => '', e => e.message), video.id)
    expect(error).toContain('아직 완료되지')
    await page.screenshot({ path: join(profile, 'legacy-video-detail.png'), fullPage: true })
    await page.getByTestId('nav-recordings').click()
    await expect(page.locator(`[data-meeting-id="${recording.id}"]`)).toBeVisible()
    await expect(page.locator(`[data-meeting-id="${video.id}"]`)).toHaveCount(0)
    await page.getByTestId('nav-home').click()
    await expect(page.locator(`[data-meeting-id="${video.id}"]`)).toBeVisible()
    await expect(page.locator(`[data-meeting-id="${recording.id}"]`)).toBeVisible()
    expect(errors).toEqual([])
    await app.close()
    const completed = new DatabaseSync(join(profile, 'yogurt.db'))
    completed.prepare("INSERT INTO segments (meeting_id,track,start_ms,end_ms,text) VALUES (?,'them',0,10000,?)").run(video.id,'스마트폰과 AI 사용에 대한 한국어 English 발화')
    completed.prepare('UPDATE meetings SET transcription_pending = 0, duration_ms = 1314000 WHERE id = ?').run(video.id)
    completed.close(); job.stage = 'done'; saveJob()
    app = await launch(); page = await app.firstWindow(); await expect(page.getByTestId('home')).toBeVisible()
    await page.getByTestId('nav-videos').click(); await page.locator(`[data-meeting-id="${video.id}"]`).click()
    await expect(page.getByTestId('video-workspace')).toBeVisible(); await page.getByTestId('video-prepare').click()
    await expect(page.getByTestId('video-start')).toBeEnabled()
    expect((await page.evaluate(id => window.yogurt.notes.get(id), recording.id)).enhanced).toBe('# 회의 편집 원문')
    expect(existsSync(join(profile, 'meetings', video.id, 'import-source.json'))).toBe(false)
    console.log('VIDEO_LEGACY_PROFILE=' + profile)
  } finally { await app.close() }
})
