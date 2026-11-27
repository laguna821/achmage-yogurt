import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('close setting persists and native close exits through the quit path', async () => {
  const profile=mkdtempSync(join(tmpdir(),'yogurt-close-'))
  const launch=()=>electron.launch({args:[join(import.meta.dirname,'../out/main/index.js'),'--ozone-platform=x11'],env:{...process.env,YOGURT_FAKE:'1',YOGURT_FAKE_PLATFORM:'linux',YOGURT_USER_DATA:profile,YOGURT_BACKGROUND:'1',YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
  let app=await launch(), child=app.process()
  try {
    let page=await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible()
    await page.getByTestId('settings-open').click()
    await expect(page.getByTestId('close-behavior')).toHaveValue('quit')
    await page.getByTestId('close-behavior').selectOption('background')
    await expect.poll(()=>JSON.parse(readFileSync(join(profile,'settings.json'),'utf8')).closeBehavior).toBe('background')
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close())
    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBeGreaterThan(0)
    await app.close();app=await launch();child=app.process();page=await app.firstWindow()
    await page.getByTestId('settings-open').click()
    await expect(page.getByTestId('close-behavior')).toHaveValue('background')
    await page.getByTestId('close-behavior').selectOption('quit')
    await expect.poll(()=>JSON.parse(readFileSync(join(profile,'settings.json'),'utf8')).closeBehavior).toBe('quit')
    const closed=app.waitForEvent('close')
    // Native titlebar X and OS Alt+F4 both invoke BrowserWindow.close.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close()).catch(()=>{})
    await closed
    expect(child.exitCode).toBe(0)
  } finally {if(child.exitCode===null)await app.close()}
})
