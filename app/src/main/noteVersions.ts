import type { Store } from './store'
import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'

export function hookNoteVersions(store:Store,changed:(id:string)=>void){
  store.db.exec(`CREATE TABLE IF NOT EXISTS note_versions (id TEXT PRIMARY KEY,meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,side TEXT NOT NULL,text TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS note_versions_meeting ON note_versions(meeting_id,created_at);
    CREATE TABLE IF NOT EXISTS note_candidates (meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,text TEXT NOT NULL,created_at INTEGER NOT NULL);`)
  const keep=(id:string,side:'mine'|'enhanced',text:string,reason:string)=>{
    if(!text)return
    const previous=store.db.prepare('SELECT text FROM note_versions WHERE meeting_id=? AND side=? ORDER BY created_at DESC LIMIT 1').get(id,side)
    if(previous?.text===text)return
    store.db.prepare('INSERT INTO note_versions VALUES (?,?,?,?,?,?)').run(randomUUID(),id,side,text,reason,Date.now())
  }
  const original=store.setNotes.bind(store)
  store.setNotes=(id,patch)=>{
    const before=store.notes(id)
    for(const side of ['mine','enhanced']as const)if(patch[side]!==undefined&&patch[side]!==before[side]&&before[side]){
      const last=store.db.prepare('SELECT created_at FROM note_versions WHERE meeting_id=? AND side=? ORDER BY created_at DESC LIMIT 1').get(id,side)
      if(patch.edited===false||!last||Date.now()-Number(last.created_at)>30_000)keep(id,side,before[side]!,patch.edited===false?'AI 재정리 전':'편집 이전 버전')
    }
    original(id,patch)
  }
  const candidate=(id:string)=>{const r=store.db.prepare('SELECT text FROM note_candidates WHERE meeting_id=?').get(id);return r?String(r.text):undefined}
  const propose=(id:string,text:string)=>{keep(id,'enhanced',store.notes(id).enhanced||'','AI 재정리 전');store.db.prepare('INSERT INTO note_candidates VALUES (?,?,?) ON CONFLICT(meeting_id) DO UPDATE SET text=excluded.text,created_at=excluded.created_at').run(id,text,Date.now());changed(id)}
  ipcMain.handle('versions:list',(_e,id:unknown)=>typeof id==='string'&&store.meeting(id)?store.db.prepare('SELECT id,side,reason,created_at AS createdAt,length(text) AS chars FROM note_versions WHERE meeting_id=? ORDER BY created_at DESC LIMIT 100').all(id):[])
  ipcMain.handle('versions:read',(_e,id:unknown,revision:unknown)=>typeof id==='string'&&typeof revision==='string'?store.db.prepare('SELECT text,side FROM note_versions WHERE id=? AND meeting_id=?').get(revision,id):undefined)
  ipcMain.handle('versions:candidate',(_e,id:unknown)=>typeof id==='string'?candidate(id):undefined)
  ipcMain.handle('versions:restore',(_e,id:unknown,revision:unknown,expected:unknown)=>{
    if(typeof id!=='string'||typeof revision!=='string'||!store.meeting(id))return false
    if(store.notes(id).enhanced!==expected)throw new Error('현재 문서가 변경됐습니다. 다시 열어 확인하세요.')
    const row=store.db.prepare("SELECT text FROM note_versions WHERE meeting_id=? AND id=? AND side='enhanced'").get(id,revision)
    if(!row)return false
    keep(id,'enhanced',store.notes(id).enhanced||'','이전 버전 복원 전');store.setNotes(id,{enhanced:String(row.text),edited:true});changed(id);return true
  })
  ipcMain.handle('versions:accept',(_e,id:unknown,expected:unknown)=>{
    if(typeof id!=='string'||!store.meeting(id))return false
    const md=candidate(id);if(md===undefined||md!==expected)throw new Error('후보가 변경됐습니다. 다시 열어 확인하세요.')
    keep(id,'enhanced',store.notes(id).enhanced||'','새 정리본 적용 전');store.setNotes(id,{enhanced:md,edited:false});store.db.prepare('DELETE FROM note_candidates WHERE meeting_id=?').run(id);changed(id);return true
  })
  return {propose,candidate}
}
