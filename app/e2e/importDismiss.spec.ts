import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

test('dismisses error banners and finished history across restarts without removing records',async()=>{
 const profile=mkdtempSync(join(tmpdir(),'yogurt-dismiss-')),id=randomUUID(),jobId=randomUUID(),doneId=randomUUID()
 const db=new DatabaseSync(join(profile,'yogurt.db'))
 db.exec(`CREATE TABLE meetings (id TEXT PRIMARY KEY,title TEXT NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER,event_id TEXT,app TEXT,attendees TEXT NOT NULL DEFAULT '[]',state TEXT NOT NULL,language TEXT);
 CREATE TABLE segments (id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT NOT NULL,track TEXT NOT NULL,start_ms INTEGER NOT NULL,end_ms INTEGER NOT NULL,text TEXT NOT NULL,speaker TEXT);
 CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT,meeting_id TEXT NOT NULL UNIQUE,mine TEXT NOT NULL DEFAULT '',enhanced TEXT,edited INTEGER NOT NULL DEFAULT 0);`)
 db.prepare("INSERT INTO meetings (id,title,started_at,ended_at,state) VALUES (?,?,1,2,'stopped')").run(id,'보존할 기록')
 db.prepare("INSERT INTO notes (meeting_id,enhanced,edited) VALUES (?,?,1)").run(id,'# 보존할 편집 문서')
 db.close();mkdirSync(join(profile,'imports'))
 const job={id:jobId,meetingId:id,title:'YouTube 영상',files:[],url:'https://youtu.be/abcdefghijk',stage:'failed',message:'HTTP Error 429',createdAt:2,updatedAt:2}
 writeFileSync(join(profile,'imports',jobId+'.json'),JSON.stringify(job))
 writeFileSync(join(profile,'imports',doneId+'.json'),JSON.stringify({...job,id:doneId,title:'완료한 작업',stage:'done',message:'완료'}))
 const launch=()=>electron.launch({args:[join(import.meta.dirname,'../out/main/index.js'),'--ozone-platform=x11'],env:{...process.env,YOGURT_FAKE:'1',YOGURT_USER_DATA:profile,YOGURT_BACKGROUND:'1',YOGURT_SYSTEM_LANGUAGES:'ko-KR'}})
 let app=await launch()
 try{
  let page=await app.firstWindow();await expect(page.getByTestId('home')).toBeVisible()
  await page.getByRole('button',{name:'YouTube 영상 알림 닫기',exact:true}).click()
  await expect(page.locator('.import-progress [data-job-id]')).toHaveCount(0)
  await page.getByRole('button',{name:'가져오기 작업',exact:true}).click()
  await expect(page.locator('.import-job-list article')).toHaveCount(1)
  await page.getByRole('button',{name:'끝난 작업 내역 지우기',exact:true}).click()
  await expect(page.locator('.import-job-list article')).toHaveCount(0)
  expect((await page.evaluate(id=>window.yogurt.notes.get(id),id)).enhanced).toBe('# 보존할 편집 문서')
  await app.close();app=await launch();page=await app.firstWindow()
  await expect(page.getByTestId('home')).toBeVisible()
  await expect(page.locator('.import-progress [data-job-id]')).toHaveCount(0)
  await page.getByRole('button',{name:'가져오기 작업',exact:true}).click()
  await expect(page.getByText('표시할 작업 내역이 없습니다.')).toBeVisible()
  expect(JSON.parse(readFileSync(join(profile,'imports',jobId+'.json'),'utf8')).dismissedAt).toBeGreaterThan(0)
  expect((await page.evaluate(id=>window.yogurt.notes.get(id),id)).enhanced).toBe('# 보존할 편집 문서')
 }finally{await app.close()}
})
