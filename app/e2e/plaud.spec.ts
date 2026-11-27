import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args=[join(import.meta.dirname,'../out/main/index.js'),'--ozone-platform=x11']
test('Plaud connection, list, selection and import are reachable',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'yogurt-plaud-ui-'))
 const app=await electron.launch({args,env:{...process.env,YOGURT_FAKE:'1',YOGURT_USER_DATA:profile,YOGURT_BACKGROUND:'1',YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
 try {
  const page=await app.firstWindow();await expect(page.getByTestId('home')).toBeVisible()
  await page.getByTestId('import-plaud').click()
  await expect(page.getByTestId('plaud-dialog')).toBeVisible()
  await expect(page.getByTestId('plaud-connect')).toHaveText('Plaud 연결')
  await expect(page.getByTestId('plaud-import-start')).toBeDisabled()
  // UI fixture only; actual OAuth/MCP/download behavior is tested in plaud.test.ts.
  await app.evaluate(({ipcMain})=>{
    let connected=false
    for(const name of ['status','connect','list','import','disconnect'])ipcMain.removeHandler('plaud:'+name)
    ipcMain.handle('plaud:status',()=>({connected,connecting:false,message:connected?'Plaud 연결 완료':'연결되지 않음'}))
    ipcMain.handle('plaud:connect',()=>{connected=true;return {connected,connecting:false,message:'Plaud 연결 완료'}})
    ipcMain.handle('plaud:disconnect',()=>{connected=false;return {connected,connecting:false,message:'연결 해제'}})
    ipcMain.handle('plaud:list',()=>[{id:'record-1',name:'이미 전사된 강의 · 한국어 English',durationMs:150000,createdAt:'2026-11-27T00:00:00Z'}])
    ipcMain.handle('plaud:import',(_e,id,options)=>{if(options.mode!=='local')throw Error('wrong import mode');if(id!=='record-1')throw Error('wrong selection');return {id:'job-1',stage:'queued'}})
  })
  await page.getByTestId('plaud-connect').click()
  await expect(page.getByText('이미 전사된 강의 · 한국어 English')).toBeVisible()
  await page.getByRole('radio').check();await expect(page.getByTestId('plaud-import-start')).toBeEnabled()
  const bounds=await page.getByTestId('plaud-dialog').boundingBox();const viewport=page.viewportSize()
  if(bounds&&viewport){expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(viewport.height+1)}
  await page.screenshot({path:test.info().outputPath('plaud-picker.png')})
  await expect(page.getByLabel('Plaud 가져오기 방식')).toHaveValue('transcript')
  await expect(page.getByRole('checkbox',{name:/원음도 보관/})).not.toBeChecked()
  await page.getByLabel('Plaud 가져오기 방식').selectOption('local')
  await page.getByTestId('plaud-import-start').click()
  await expect(page.getByText('로컬 전사 대기열에 등록했습니다.',{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'닫기',exact:true}).click()
 } finally {await app.close()}
})

test('Plaud settings are reachable in the real app mode',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'yogurt-plaud-settings-'))
 writeFileSync(join(profile,'settings.json'),JSON.stringify({welcomed:true,language:'ko',openAtLogin:false,autoUpdate:false}))
 const app=await electron.launch({args,env:{...process.env,YOGURT_FAKE:'0',YOGURT_USER_DATA:profile,YOGURT_BACKGROUND:'1',YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
 try{
  const page=await app.firstWindow()
  // Only bypass model setup in this empty isolated profile. Real settings and Plaud IPC remain intact.
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('setup:state');ipcMain.handle('setup:state',()=>({phase:'ready'}))})
  await page.reload()
  await expect(page.getByTestId('home')).toBeVisible()
  await page.getByTestId('settings-open').click()
  await page.getByTestId('settings-section-sources').click()
  await expect(page.getByTestId('plaud-settings')).toBeVisible()
  await expect(page.getByTestId('plaud-connect')).toBeEnabled()
  await page.screenshot({path:test.info().outputPath('plaud-settings.png')})
 }finally{await app.close()}
})

test('existing Plaud text opens context preparation with notes and never starts paid AI automatically',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'yogurt-plaud-handoff-')),file=join(profile,'transcript.json')
 writeFileSync(file,JSON.stringify([{text:'한국어 English 회의 원문',speaker:'교수 A',startMs:110,endMs:22750}]))
 writeFileSync(join(profile,'settings.json'),JSON.stringify({welcomed:true,language:'ko',openAtLogin:false,autoUpdate:false}))
 const app=await electron.launch({args,env:{...process.env,YOGURT_FAKE:'0',YOGURT_USER_DATA:profile,YOGURT_BACKGROUND:'1',YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
 try{
  const page=await app.firstWindow()
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('setup:state');ipcMain.handle('setup:state',()=>({phase:'ready'}))})
  await page.reload();await expect(page.getByTestId('home')).toBeVisible()
  const added=await page.evaluate(path=>window.yogurt.imports.start({paths:[path],title:'Plaud handoff fixture'}),file)
  await expect.poll(()=>page.evaluate(id=>window.yogurt.imports.list().then(jobs=>jobs.find(j=>j.id===id)?.stage),added.id)).toBe('done')
  const job=await page.evaluate(id=>window.yogurt.imports.list().then(jobs=>jobs.find(j=>j.id===id)!),added.id)
  await page.evaluate(async id=>{
    const s=await window.yogurt.organizer.get(id)
    await window.yogurt.organizer.configure(id,s.options,{...s.context,participants:'Plaud 전사에 표시된 화자: 교수 A'})
    await window.yogurt.organizer.attachBytes(id,[{name:'Plaud 정리본.md',data:btoa('# Plaud secondary summary')}])
  },job.meetingId!)
  await app.evaluate(({ipcMain},job)=>{
    for(const name of ['plaud:status','plaud:list','plaud:import','organizer:start'])ipcMain.removeHandler(name)
    ;(globalThis as any).__plaudAIStarts=0
    ipcMain.handle('organizer:start',()=>{(globalThis as any).__plaudAIStarts++;throw Error('AI must not start in this test')})
    ipcMain.handle('plaud:status',()=>({connected:true,connecting:false,message:'연결됨'}))
    ipcMain.handle('plaud:list',()=>[{id:'fixture',name:'Plaud handoff fixture',durationMs:23000,createdAt:'2026-11-17T12:00:00Z'}])
    ipcMain.handle('plaud:import',(_e,id,options)=>{if(id!=='fixture'||options.mode!=='transcript'||options.keepAudio)throw Error('bad selection');return job})
  },job)
  await page.getByTestId('import-plaud').click();await page.getByRole('radio').check()
  await page.getByTestId('plaud-import-start').click()
  await expect(page.getByTestId('organizer-preflight')).toBeVisible()
  await expect(page.getByTestId('organizer-participants')).toHaveValue(/교수 A/)
  await expect(page.getByText('자료 읽음 · 0-Plaud 정리본.md',{exact:false})).toBeVisible()
  await expect(page.getByTestId('organizer-start')).toBeVisible()
  expect(await app.evaluate(()=> (globalThis as any).__plaudAIStarts)).toBe(0)
  await page.screenshot({path:test.info().outputPath('plaud-handoff.png')})
  await page.getByRole('button',{name:'자료만 저장',exact:true}).click()
  await expect(page.getByTestId('organizer-preflight')).not.toBeVisible()
 }finally{await app.close()}
})
