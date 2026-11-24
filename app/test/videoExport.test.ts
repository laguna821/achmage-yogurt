import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { open } from 'yauzl'
vi.mock('electron',()=>({clipboard:{},ClipboardItem:class{},dialog:{},ipcMain:{},protocol:{}}))
import { videoAssets, writeVideoZip } from '../src/main/video/ipc'
const dirs:string[]=[]
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
it('exports exact Markdown and registered image bytes with portable relative paths',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'video-export-'));dirs.push(dir)
 const file='frame-1234567890abcdef.jpg',path=join(dir,file),md=`# 문서\n\n| 한글 | English |\n|---|---|\n\n![화면](assets/${file})\n`,archive=join(dir,'document.zip')
 writeFileSync(path,Buffer.from('actual image bytes'))
 expect(videoAssets(md+'\n![escape](assets/../../secret)')).toEqual([file])
 await writeVideoZip(archive,'문서.md',md,[{file,path}])
 const entries=await new Promise<Record<string,Buffer>>((resolve,reject)=>open(archive,{lazyEntries:true},(err,zip)=>{
  if(err||!zip){reject(err);return}const out:Record<string,Buffer>={};zip.on('error',reject);zip.on('end',()=>resolve(out));zip.on('entry',entry=>zip.openReadStream(entry,(e,stream)=>{if(e||!stream){reject(e);return}const chunks:Buffer[]=[];stream.on('data',b=>chunks.push(b));stream.on('error',reject);stream.on('end',()=>{out[entry.fileName]=Buffer.concat(chunks);zip.readEntry()})}));zip.readEntry()
 }))
 expect(Object.keys(entries)).toEqual(['문서.md','assets/'+file]);expect(entries['문서.md'].toString('utf8')).toBe(md);expect(entries['assets/'+file]).toEqual(readFileSync(path))
})
