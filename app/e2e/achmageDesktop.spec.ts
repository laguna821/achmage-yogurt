import{_electron as electron,expect,test}from'@playwright/test'
import{mkdtempSync,writeFileSync,readFileSync}from'node:fs'
import{tmpdir}from'node:os'
import{join}from'node:path'
test('external transcript, lossless Markdown editing, 27 skins and restart persistence',async()=>{
  const profile=mkdtempSync(join(tmpdir(),'achmage-desktop-')),file=join(profile,'강의.srt')
  writeFileSync(file,'1\n00:00:01,000 --> 00:00:04,000\n한국어와 English term을 논의했습니다.\n')
  const launch=()=>electron.launch({args:[join(import.meta.dirname,'../out/main/index.js')],env:{...process.env,YOGURT_FAKE:'1',YOGURT_USER_DATA:profile,YOGURT_BACKGROUND:'1',YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
  let app=await launch()
  try{
    let page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
    await expect(page.getByTestId('home')).toBeVisible()
    await page.getByTestId('import-files').click();await expect(page.getByTestId('import-dialog')).toBeVisible();await expect(page.getByTestId('import-dialog')).toHaveCSS('opacity','1')
    await page.screenshot({path:join(profile,'import-dialog.png')})
    await page.getByTestId('import-dialog').getByRole('button',{name:'닫기',exact:true}).click()
    const job=await page.evaluate(path=>window.yogurt.imports.start({paths:[path]}),file)
    await expect.poll(async()=>{return(await page.evaluate(()=>window.yogurt.imports.list()))[0].stage}).toBe('done')
    const jobs=await page.evaluate(()=>window.yogurt.imports.list()),id=jobs.find(j=>j.id===job.id)!.meetingId!
    expect((await page.evaluate(id=>window.yogurt.transcript.get(id),id))[0].text).toContain('English term')
    const original='서문\n\n## 한국어 강의록\n\n| 용어 | 내용 |\n| --- | --- |\n| English | 원문 보존 |\n\n```unknown-language\n원문 **보존**\n```\n\n[[위키링크]]\n'
    await page.evaluate(async({id,original})=>{await window.yogurt.notes.setEnhanced(id,original,1);window.yogurt.nav.go('/note/'+id)},{id,original})
    await expect(page.getByTestId('note-enhanced-editor')).toBeVisible()
    await expect(page.getByTestId('note-enhanced-editor').locator('table')).toBeVisible()
    await page.screenshot({path:join(profile,'markdown-live.png')})
    await page.getByRole('button',{name:'원문',exact:true}).click()
    const edit=page.getByTestId('note-enhanced-editor')
    await edit.click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.insertText('추가한 한국어 메모')
    await page.getByRole('button',{name:'읽기',exact:true}).click()
    await expect.poll(async()=>(await page.evaluate(id=>window.yogurt.notes.get(id),id)).enhanced).toBe(original+'\n추가한 한국어 메모')
    await page.getByTestId('settings-open').click();await page.getByRole('button',{name:'스킨·모양',exact:true}).click()
    await expect(page.locator('.skin-card')).toHaveCount(27)
    await page.getByLabel('스킨 화면 모드').selectOption('light');await page.getByTestId('skin-wine-petal-light').click()
    await expect(page.locator('html')).toHaveAttribute('data-skin','wine-petal-light')
    await page.screenshot({path:join(profile,'skin-petal.png')})
    await page.getByLabel('스킨 화면 모드').selectOption('dark');await page.getByTestId('skin-cyber-lime-dark').click()
    await expect(page.locator('html')).toHaveAttribute('data-skin','cyber-lime-dark')
    await page.screenshot({path:join(profile,'skin-lime.png')})
    expect(errors).toEqual([])
    await app.close();app=await launch();page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());await expect(page.getByTestId('home')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-skin','cyber-lime-dark')
    expect((await page.evaluate(id=>window.yogurt.notes.get(id),id)).enhanced).toBe(original+'\n추가한 한국어 메모')
    expect(readFileSync(join(profile,'meetings',id,'original','0-강의.srt'),'utf8')).toContain('English term')
    console.log('ACHMAGE_E2E_PROFILE='+profile)
  }finally{await app.close()}
})
