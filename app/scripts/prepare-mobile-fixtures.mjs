// Read-only extraction; output is private and must stay outside the public repository.
import{DatabaseSync}from'node:sqlite';
import{readFileSync,writeFileSync,existsSync}from'node:fs';import{resolve,join,relative}from'node:path';import{createHash}from'node:crypto';
const[metricsPath,profilePath,outputPath]=process.argv.slice(2);if(!outputPath)throw Error('Usage: node prepare-mobile-fixtures.mjs metrics.json profile-directory /private/mobile-fixtures.json');
const repo=resolve(import.meta.dirname,'../..'),output=resolve(outputPath);if(!relative(repo,output).startsWith('..'))throw Error('Private fixture output must be outside the repository');
const db=new DatabaseSync(join(profilePath,'yogurt.db'),{readOnly:true});
const rows=JSON.parse(readFileSync(metricsPath,'utf8')).rows;
const fixtures=rows.map(r=>({id:'kpf-'+r.week,label:'KPF '+r.week+'주차',url:r.url,durationSeconds:r.mediaDurationSeconds,md:readFileSync(r.notePath,'utf8'),vtt:readFileSync(join(profilePath,'meetings',r.meetingId,'original/youtube.ko.vtt'),'utf8')}));
const id='90f1d784-aa9d-471c-aeae-2c1bc4953f4d',folder=join(profilePath,'meetings',id),infoPath=join(folder,'original/youtube.info.json');
if(existsSync(infoPath)){const info=JSON.parse(readFileSync(infoPath,'utf8')),vtt=join(folder,'original/youtube.ko.vtt');fixtures.push({id:'the-prompt',label:'더 프롬프트 · 스마트폰',url:info.webpage_url||'https://www.youtube.com/watch?v='+info.id,durationSeconds:info.duration,md:db.prepare('SELECT enhanced FROM notes WHERE meeting_id=?').get(id)?.enhanced||'# '+info.title+'\n',transcript:JSON.stringify(db.prepare('SELECT text,start_ms AS startMs,end_ms AS endMs,speaker FROM segments WHERE meeting_id=? AND hidden=0 ORDER BY start_ms,id').all(id)),...(existsSync(vtt)?{vtt:readFileSync(vtt,'utf8')}:{})})}
db.close();
const manifest=fixtures.map(f=>({id:f.id,url:f.url,durationSeconds:f.durationSeconds,mdSha256:createHash('sha256').update(f.md).digest('hex'),transcriptSha256:f.transcript?createHash('sha256').update(f.transcript).digest('hex'):null,vttSha256:f.vtt?createHash('sha256').update(f.vtt).digest('hex'):null}));
writeFileSync(output,JSON.stringify({private:true,createdAt:new Date().toISOString(),fixtures,manifest}),{mode:0o600});console.log(JSON.stringify({output,fixtures:manifest},null,2));
