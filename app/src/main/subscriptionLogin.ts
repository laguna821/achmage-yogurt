import { app,shell } from 'electron'
import { spawn } from 'node:child_process'
import { subscriptionCli,subscriptionEnv } from './subscriptionEngine'

/** Official app-server hosts the browser callback and owns credential storage. No inference call. */
export function browserSubscriptionLogin():Promise<{ok:boolean;message:string}>{
  return new Promise(resolve=>{
    const child=spawn(subscriptionCli('codex'),['app-server','--listen','stdio://','-c','features.apps=false','-c','features.plugins=false'],{env:subscriptionEnv(),windowsHide:true,stdio:['pipe','pipe','pipe']})
    let buffer='',answered=false,closed=false
    const reply=(ok:boolean,message:string)=>{if(!answered){answered=true;resolve({ok,message})}}
    const finish=()=>{if(closed)return;closed=true;app.removeListener('will-quit',finish);clearTimeout(timer);child.stdin.end();const t=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGTERM')},1500);t.unref()}
    const send=(x:object)=>child.stdin.write(JSON.stringify(x)+'\n')
    const timer=setTimeout(()=>{reply(false,'로그인 시간이 지났습니다. 다시 시도하세요.');finish()},180_000);timer.unref()
    child.on('error',()=>{reply(false,'로그인 도구를 실행하지 못했습니다. 설치 상태를 확인하세요.');finish()});child.on('exit',()=>{reply(false,'로그인이 완료되지 않았습니다.');finish()})
    child.stdin.on('error',()=>{});child.stderr.resume()
    child.stdout.setEncoding('utf8');child.stdout.on('data',(text:string)=>{
      buffer+=text;if(buffer.length>1_000_000){reply(false,'로그인 응답을 읽지 못했습니다.');finish();return}
      let at:number;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1)
        try{const r=JSON.parse(line)
          if(r.error){reply(false,String(r.error.message||'로그인을 시작하지 못했습니다.'));finish();return}
          if(r.id===1){send({method:'initialized',params:{}});send({id:2,method:'account/login/start',params:{type:'chatgpt'}})}
          if(r.id===2){const url=new URL(r.result.authUrl);if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com','auth0.openai.com'].includes(url.hostname))throw new Error('잘못된 로그인 주소');void shell.openExternal(url.toString());reply(true,'브라우저에서 ChatGPT 로그인을 마친 뒤 연결 새로고침을 누르세요.')}
          if(r.method==='account/login/completed')finish()
        }catch{if(line.startsWith('{')){reply(false,'로그인 응답을 확인하지 못했습니다.');finish()}}
      }
    })
    app.once('will-quit',finish)
    send({id:1,method:'initialize',params:{clientInfo:{name:'achmage-yogurt',title:'Achmage Yogurt',version:'0.4.0'},capabilities:{}}})
  })
}
