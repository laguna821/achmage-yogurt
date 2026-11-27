import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const source='flowchart LR\nA[검토] --> B[완료]:::achmage\nB --> C[브랜드]:::brand-blue\nC --> D[강조]\nstyle D fill:#007f78,color:#fff,stroke:#007f78'
const fenced='```mermaid\n'+source+'\n```\n'
const md='# 검토 문서\n\n앞 문단을 보존합니다.\n\n'+fenced+'\n마지막 문단을 보존합니다.\n'
test('Pele preview/source/copy/edit/theme work without rewriting Markdown',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'yogurt-pele-')),transcript=join(profile,'lecture.txt');writeFileSync(transcript,'한국어 전사 시험')
 const app=await electron.launch({args:[join(import.meta.dirname,'../out/main/index.js'),'--ozone-platform=x11'],env:{...process.env,YOGURT_FAKE:'1',YOGURT_USER_DATA:profile,YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
 try{
  const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await expect(page.getByTestId('home')).toBeVisible()
  const job=await page.evaluate(path=>window.yogurt.imports.start({paths:[path]}),transcript)
  await expect.poll(async()=> (await page.evaluate(()=>window.yogurt.imports.list())).find(j=>j.id===job.id)?.stage).toBe('done')
  const id=(await page.evaluate(()=>window.yogurt.imports.list()))[0].meetingId!
  await page.evaluate(async({id,md})=>{await window.yogurt.notes.setEnhanced(id,md,1);await window.yogurt.notes.setMine(id,md,1);window.yogurt.nav.go('/note/'+id)},{id,md})
  await page.getByTestId('note-summary-tab').click()
  const root=page.locator('.markdown-editor').filter({has:page.getByTestId('note-enhanced-editor')})
  await root.getByRole('button',{name:'라이브 편집',exact:true}).click()
  await expect(root.locator('svg.pele')).toHaveCount(1)
  await expect(root.locator('[data-id="D"] rect')).toHaveCSS('fill','rgb(0, 127, 120)')
  const originalFill=await root.locator('[data-id="B"] rect').evaluate(el=>getComputedStyle(el).fill)
  await page.evaluate(()=>window.yogurt.appearance.set({mode:'dark',dark:'atlas-graphite'}))
  await expect.poll(()=>root.locator('[data-id="B"] rect').evaluate(el=>getComputedStyle(el).fill)).not.toBe(originalFill)
  await root.getByRole('button',{name:'Mermaid 코드 블록 복사'}).click()
  await expect(root.getByRole('button',{name:'Mermaid 코드 블록 복사'})).toHaveText('복사됨')
  await expect.poll(()=>app.evaluate(({clipboard})=>clipboard.readText())).toBe(fenced.trimEnd())
  await root.getByRole('button',{name:'Mermaid 소스 보기'}).click()
  await expect(root.locator('.cm-line').filter({hasText:'flowchart LR'})).toBeVisible()
  await root.locator('.cm-line').filter({hasText:'flowchart LR'}).click()
  await page.keyboard.press('End');await page.keyboard.press('Enter')
  await page.keyboard.insertText('%% 수정 확인')
  const edited=md.replace('flowchart LR\n','flowchart LR\n%% 수정 확인\n')
  await root.getByRole('button',{name:'다이어그램으로 보기'}).click()
  await expect(root.locator('svg.pele')).toHaveCount(1)
  await expect.poll(()=>page.evaluate(id=>window.yogurt.notes.get(id).then(n=>n.enhanced),id)).toBe(edited)
  await root.getByRole('button',{name:'Mermaid 소스 보기'}).click();await page.keyboard.press('Control+z')
  await root.getByRole('button',{name:'다이어그램으로 보기'}).click()
  await expect.poll(()=>page.evaluate(id=>window.yogurt.notes.get(id).then(n=>n.enhanced),id)).toBe(md)
  await root.getByRole('button',{name:'Mermaid 소스 보기'}).click()
  await page.getByRole('heading',{name:'lecture',exact:true}).click()
  await expect(root.locator('svg.pele')).toHaveCount(1)
  await root.getByRole('button',{name:'읽기',exact:true}).click()
  await root.getByRole('button',{name:'Mermaid 소스 보기'}).click()
  await expect(root.locator('pre')).toContainText('```mermaid')
  await root.getByRole('button',{name:'Mermaid 소스 보기'}).click()
  await expect(root.locator('svg.pele')).toBeVisible()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1024,680))
  await page.screenshot({path:join(profile,'pele-dark.png'),fullPage:true})
  await page.getByTestId('note-notes-tab').click()
  await expect(page.getByTestId('note-mine').locator('svg.pele')).toHaveCount(1)
  await page.reload();await page.waitForFunction(()=>!!window.yogurt)
  expect((await page.evaluate(id=>window.yogurt.notes.get(id),id)).enhanced).toBe(md)
  expect(errors).toEqual([]);console.log('PELE_PROFILE='+profile)
 }finally{await app.close()}
})

test('Pele errors retain source and diagram directives cannot request external content',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'yogurt-pele-safe-')),file=join(profile,'safe.txt');writeFileSync(file,'안전 시험')
 const app=await electron.launch({args:[join(import.meta.dirname,'../out/main/index.js'),'--ozone-platform=x11'],env:{...process.env,YOGURT_FAKE:'1',YOGURT_USER_DATA:profile,YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
 try{
  const page=await app.firstWindow();await expect(page.getByTestId('home')).toBeVisible();const requests:string[]=[];page.on('request',r=>{if(r.url().includes('example.invalid'))requests.push(r.url())})
  const job=await page.evaluate(path=>window.yogurt.imports.start({paths:[path]}),file)
  await expect.poll(async()=> (await page.evaluate(()=>window.yogurt.imports.list())).find(j=>j.id===job.id)?.stage).toBe('done')
  const id=(await page.evaluate(()=>window.yogurt.imports.list()))[0].meetingId!
  const unsafe='```mermaid\nflowchart LR\nA[안전] --> B[검토]\nclick A "https://example.invalid/track"\n```\n\n```mermaid\nNOT A DIAGRAM\n```\n'
  await page.evaluate(async({id,unsafe})=>{await window.yogurt.notes.setEnhanced(id,unsafe,1);window.yogurt.nav.go('/note/'+id)},{id,unsafe});await page.getByTestId('note-summary-tab').click()
  const root=page.locator('.markdown-editor').filter({has:page.getByTestId('note-enhanced-editor')})
  await root.getByRole('button',{name:'라이브 편집',exact:true}).click()
  await expect(root.locator('[data-rendered=true]')).toHaveCount(1);await expect(root.locator('[data-rendered=false]')).toHaveCount(1)
  expect(await root.locator('svg a, svg image, svg foreignObject, svg script').count()).toBe(0)
  await root.getByRole('button',{name:'Mermaid 소스 보기'}).last().click();await expect(root.locator('.cm-line').filter({hasText:'NOT A DIAGRAM'})).toBeVisible()
  expect((await page.evaluate(id=>window.yogurt.notes.get(id),id)).enhanced).toBe(unsafe);expect(requests).toEqual([])
 }finally{await app.close()}
})
