import { DatabaseSync,backup } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { cp,link,mkdir,readdir,copyFile,rename,rm,writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function copyModels(from:string,to:string){
  await mkdir(to,{recursive:true})
  for(const entry of await readdir(from,{withFileTypes:true})){
    const source=join(from,entry.name),target=join(to,entry.name)
    if(entry.name.endsWith('.part'))continue
    if(entry.isDirectory())await copyModels(source,target)
    else if(entry.isFile())await link(source,target).catch(()=>copyFile(source,target))
  }
}
/** Create an independent profile from a consistent read-only SQLite snapshot. Originals stay intact. */
export async function migrateLegacyProfile(legacy:string,destination:string):Promise<void>{
  if(legacy===destination||existsSync(join(destination,'yogurt.db'))||!existsSync(join(legacy,'yogurt.db')))return
  const stage=join(destination,'.migration-staging');await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true})
  const db=new DatabaseSync(join(legacy,'yogurt.db'),{readOnly:true})
  try{
    const recording=db.prepare("SELECT count(*) AS n FROM meetings WHERE state='recording'").get()
    if(Number(recording?.n)>0)throw new Error('기존 Yogurt의 녹음을 끝낸 뒤 Achmage Yogurt를 다시 실행하면 기록을 가져옵니다.')
    await backup(db,join(stage,'yogurt.db'))
    for(const name of ['meetings','organizer','settings.json','speech-speed.json'])if(existsSync(join(legacy,name)))await cp(join(legacy,name),join(stage,name),{recursive:true,force:false,errorOnExist:true})
    if(existsSync(join(legacy,'models')))await copyModels(join(legacy,'models'),join(stage,'models'))
    for(const entry of (await readdir(stage)).filter(e=>e!=='yogurt.db')){
      const from=join(stage,entry),to=join(destination,entry)
      if(existsSync(to))await cp(from,to,{recursive:true,force:false,errorOnExist:false});else await rename(from,to)
    }
    await writeFile(join(destination,'migration.json'),JSON.stringify({from:legacy,at:new Date().toISOString(),method:'read-only-sqlite-backup-and-copy',models:'hardlinks-where-supported',originalPreserved:true},null,2),{mode:0o600})
    await rename(join(stage,'yogurt.db'),join(destination,'yogurt.db'))
  }finally{db.close();await rm(stage,{recursive:true,force:true})}
}
