import {createHash}from'node:crypto'
import{existsSync,readFileSync}from'node:fs'
import{readdir,readFile,stat}from'node:fs/promises'
import{extname,join,relative}from'node:path'
import type{RecordIssue}from'../../shared/organizer'
import type{EvidenceLookup}from'./evidence'
import{loadSettings}from'../settings'
let profile:string|undefined
export function setSourceProfile(path:string){profile=path}
export const localVaultPath=()=>profile?loadSettings(join(profile,'settings.json')).vaultPath:undefined
export const sourceConfigPath=()=>profile?join(profile,'source-connections.json'):undefined
export async function localVaultEvidence(issues:RecordIssue[],seed:string,signal?:AbortSignal):Promise<EvidenceLookup>{
  const root=localVaultPath(),out:EvidenceLookup={evidence:[],status:{provider:'vault',connected:!!root,detail:root?'선택한 볼트에서 찾고 있습니다.':'볼트 폴더가 선택되지 않았습니다.'},log:[]}
  if(!root||!existsSync(root))return out
  const terms=[...new Set([seed,...issues.map(i=>i.query)].join(' ').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(s=>s.length>1))].slice(0,40)
  const ranked:{path:string;text:string;score:number}[]=[];let count=0,bytes=0
  async function walk(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){
    if(signal?.aborted)throw new Error('Stopped')
    if(entry.name.startsWith('.')||['node_modules','attachments','assets'].includes(entry.name)||count>=5000||bytes>30_000_000)continue
    const path=join(dir,entry.name)
    if(entry.isDirectory())await walk(path)
    else if(entry.isFile()&&['.md','.txt'].includes(extname(path).toLowerCase())){count++;const info=await stat(path);if(info.size>500_000)continue;bytes+=info.size;const text=await readFile(path,'utf8'),title=relative(root!,path).toLowerCase(),body=text.toLowerCase();const score=terms.reduce((n,t)=>n+(title.includes(t)?5:0)+(body.includes(t)?1:0),0);if(score)ranked.push({path,text,score})}
  }}
  try{await walk(root);ranked.sort((a,b)=>b.score-a.score);out.evidence=ranked.slice(0,7).map((r,n)=>({id:'V'+(n+1),provider:'vault',title:relative(root,r.path),locator:r.path,revision:createHash('sha256').update(r.text).digest('hex'),text:r.text.slice(0,7500),issueIds:issues.map(i=>i.id)}));out.status.detail=`선택한 볼트 ${count}개 파일에서 관련 자료 ${out.evidence.length}건을 읽었습니다.`;out.log.push(out.status.detail+(count>=5000||bytes>30_000_000?' (검색 상한에 도달하여 일부 파일은 제외됨)':''))}catch(e){if(signal?.aborted)throw e;out.status.detail='볼트 파일을 일부 읽지 못했습니다.';out.log.push(out.status.detail)}
  return out
}
