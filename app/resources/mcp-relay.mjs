// Byte relay only. No inference, credentials or local shell commands.
import {connect} from 'node:net'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
const profile=process.env.YOGURT_USER_DATA
if(!profile)throw new Error('MCP 설정에 YOGURT_USER_DATA가 필요합니다.')
function once(){return new Promise(resolve=>{let address;try{address=process.platform==='win32'?readFileSync(join(profile,'mcp.pipe'),'utf8').trim():join(profile,'mcp.sock')}catch{return resolve()}
  const s=connect(address);s.once('error',()=>{s.destroy();resolve()});s.once('connect',()=>{s.removeAllListeners('error');resolve(s)})})}
let socket=await once()
if(!socket){
  if(process.platform==='darwin'){const p=spawn('/usr/bin/open',['-g','-b','com.achmage.yogurt','--args','--hidden'],{stdio:'ignore',detached:true});p.on('error',()=>{});p.unref()}
  else{try{const exe=readFileSync(join(profile,'mcp-launch'),'utf8').trim();const p=spawn(exe,['--hidden'],{stdio:'ignore',detached:true});p.on('error',()=>{});p.unref()}catch{}}
  for(let n=0;n<60&&!socket;n++){await new Promise(r=>setTimeout(r,500));socket=await once()}
}
if(!socket){process.stderr.write('Achmage Yogurt를 열고 다시 연결하세요.\n');process.exit(1)}
socket.on('error',()=>process.exit(1));socket.on('close',()=>process.exit(0));process.stdin.pipe(socket);socket.pipe(process.stdout);process.stdin.on('end',()=>socket.end())
