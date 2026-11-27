import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecordActivity } from '../src/shared/activity'

test('independent row trails, waiting, completion, theme and reduced motion', async () => {
  const app = await electron.launch({ args: [join(import.meta.dirname, '../out/main/index.js'), '--ozone-platform=x11'], env: {
    ...process.env, YOGURT_FAKE: '1', YOGURT_FAKE_REMOTE: '1', YOGURT_BACKGROUND: '1', YOGURT_USER_DATA: mkdtempSync(join(tmpdir(), 'yogurt-row-activity-')),
  } })
  try {
    const page = await app.firstWindow(); await expect(page.getByTestId('home')).toBeVisible()
    const win = await app.browserWindow(page); await win.evaluate(w => w.setContentSize(1100, 780))
    await app.evaluate(async () => { await (globalThis as any).__fake__.manyMeetings(6) })
    await page.reload(); await expect(page.locator('[data-row-id]')).toHaveCount(6)
    const ids = await page.evaluate(async () => (await window.yogurt.meetings.cards({ limit: 6 })).map(m => m.id))
    const push = async (rows: RecordActivity[]) => app.evaluate(({ BrowserWindow, ipcMain }, rows) => {
      ipcMain.removeHandler('activity:list'); ipcMain.handle('activity:list', () => rows)
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send('activity:changed', rows)
    }, rows)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const rows: RecordActivity[] = ids.slice(0,3).map((meetingId, i) => ({ meetingId, state: 'active', label: ['자료 대조 중','영상 내용 정리 중','최종 문서 확인 중'][i] }))
    await push(rows)
    await expect(page.locator('[data-row-id][data-activity="active"]')).toHaveCount(3)
    await expect(page.locator('.library-work-count')).toContainText('3개')
    const row = page.locator(`[data-row-id="${ids[0]}"]`)
    expect(await row.evaluate(el => getComputedStyle(el, '::after').animationName)).toBe('record-trail')
    const angle = await row.evaluate(el => getComputedStyle(el, '::after').getPropertyValue('--record-trail-angle'))
    await expect.poll(() => row.evaluate(el => getComputedStyle(el, '::after').getPropertyValue('--record-trail-angle'))).not.toBe(angle)
    await page.screenshot({ path: test.info().outputPath('parallel-records.png') })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    expect(await row.evaluate(el => getComputedStyle(el, '::after').animationName)).toBe('none')
    await push([{ ...rows[0], state: 'waiting', label: 'AI 요청 제한 · 5초 후 재시도' }, rows[2]])
    await expect(page.locator('[data-row-id][data-activity="active"]')).toHaveCount(1)
    await expect(row).toHaveAttribute('data-activity', 'waiting')
    await expect(row).toContainText('요청 제한')
    await page.reload(); await expect(row).toHaveAttribute('data-activity', 'waiting')
    await push([{ ...rows[2], state: 'failed', label: '정리 실패 · 기록에서 확인' }])
    await expect(page.locator('[data-row-id][data-activity="active"]')).toHaveCount(0)
    await expect(page.locator('.library-work-count')).toHaveCount(0)
    await expect(page.locator(`[data-row-id="${ids[2]}"]`)).toContainText('정리 실패')
    await push([]); await expect(page.locator('[data-row-id][data-activity]')).toHaveCount(0)
  } finally { await app.close() }
})
