// Prepare offline runtimes for this build host. Never include credentials or a user profile.
import {createHash} from 'node:crypto'
import {chmodSync,copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),tools=join(root,'resources/tools'),staging=join(root,'.tool-staging')
mkdirSync(tools,{recursive:true});mkdirSync(staging,{recursive:true})
const win=process.platform==='win32',suffix=win?'.exe':'',records=[]
const digest=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const copy=(src,name,source)=>{if(!existsSync(src))throw new Error('Missing runtime: '+src);const dest=join(tools,name+suffix);copyFileSync(src,dest);if(!win)chmodSync(dest,0o755);records.push({name,source,sha256:digest(dest)});return dest}
async function get(url){const r=await fetch(url,{headers:{'User-Agent':'Achmage-Yogurt-build'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r}
async function download(url,file,sha){
  if(existsSync(file)&&digest(file)===sha)return
  const b=Buffer.from(await(await get(url)).arrayBuffer());if(createHash('sha256').update(b).digest('hex')!==sha)throw new Error('Checksum mismatch: '+url);writeFileSync(file,b)
}
const run=(bin,args,opts={})=>execFileSync(bin,args,{stdio:'inherit',...opts})
const ff=require('ffmpeg-static')
if(!existsSync(ff))run(process.execPath,[join(dirname(require.resolve('ffmpeg-static')),'install.js')])
copy(ff,'ffmpeg','ffmpeg-static '+require('ffmpeg-static/package.json').version)
copy(require('ffprobe-static').path,'ffprobe','ffprobe-static '+require('ffprobe-static/package.json').version)
// A real Node runtime is required: packaged Electron deliberately disables ELECTRON_RUN_AS_NODE.
copy(process.execPath,'node','Node.js '+process.version)
const yt=await(await get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')).json()
const ytName=win?'yt-dlp.exe':process.platform==='darwin'?'yt-dlp_macos':'yt-dlp_linux'
const sums=await(await get(yt.assets.find(a=>a.name==='SHA2-256SUMS').browser_download_url)).text()
const ytSha=sums.split('\n').find(l=>l.trim().endsWith(ytName))?.trim().split(/\s+/)[0]
if(!ytSha)throw new Error('yt-dlp checksum not found')
const ytFile=join(staging,ytName);await download(yt.assets.find(a=>a.name===ytName).browser_download_url,ytFile,ytSha);copy(ytFile,'yt-dlp','yt-dlp '+yt.tag_name)
// The owner-authored transcript skill runs unchanged with a bundled CPython.
const py=await(await get('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest')).json()
const triple=win?'x86_64-pc-windows-msvc':process.platform==='darwin'?(process.arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin'):'x86_64-unknown-linux-gnu'
const asset=py.assets.find(a=>a.name.startsWith('cpython-3.13.')&&a.name.includes(triple+'-install_only')&&a.name.endsWith('-install_only_stripped.tar.gz'))
if(!asset)throw new Error('CPython build not found for '+triple)
const pySha=asset.digest?.replace(/^sha256:/,'')
if(!/^[a-f0-9]{64}$/.test(pySha||''))throw new Error('CPython release asset is missing a SHA256 digest')
const archive=join(staging,asset.name);await download(asset.browser_download_url,archive,pySha)
if(!existsSync(join(root,'resources/python',win?'python.exe':'bin/python3'))){run('tar',['-xzf',archive,'-C',join(root,'resources')])}
records.push({name:'python',source:asset.browser_download_url,sha256:pySha})
// Ship the official native Codex client; it owns login and its credentials on each machine.
const prefix=join(staging,'codex')
if(!existsSync(join(prefix,'node_modules/@openai/codex'))){run(win?'npm.cmd':'npm',['install','--prefix',prefix,'--no-audit','--no-fund','@openai/codex@0.171.0'],{shell:win})}
const packageDir=readdirSync(join(prefix,'node_modules/@openai')).find(n=>n.startsWith('codex-'))
if(!packageDir)throw new Error('Codex platform package was not installed')
const vendor=join(prefix,'node_modules/@openai',packageDir,'vendor'),target=readdirSync(vendor).find(n=>!n.startsWith('.')),bin=join(vendor,target,'bin')
cpSync(bin,tools,{recursive:true});records.push({name:'codex',source:'@openai/'+packageDir+' 0.171.0',sha256:digest(join(tools,'codex'+suffix))})
// PDF worker stays outside asar and is loaded only when extracting a PDF.
mkdirSync(join(root,'resources/pdf'),{recursive:true});copyFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),join(root,'resources/pdf/pdf.worker.mjs'))
const license=join(root,'resources/licenses/runtime-tools');mkdirSync(license,{recursive:true})
for(const name of ['ffmpeg-static','ffprobe-static','mammoth','mailparser','pdfjs-dist'])for(const file of ['LICENSE','LICENSE.txt','LICENSE.md']){const p=join(dirname(require.resolve(name+'/package.json')),file);if(existsSync(p))copyFileSync(p,join(license,name+'-'+file))}
for(const [src,name]of [[ff+'.LICENSE','FFMPEG-BINARY-LICENSE'],[ff+'.README','FFMPEG-BUILD-README']])if(existsSync(src))copyFileSync(src,join(license,name))
for(const [url,name]of [['https://raw.githubusercontent.com/openai/codex/rust-v0.171.0/LICENSE','CODEX-LICENSE'],['https://raw.githubusercontent.com/yt-dlp/yt-dlp/'+yt.tag_name+'/LICENSE','YT-DLP-LICENSE']])writeFileSync(join(license,name),await(await get(url)).text())
writeFileSync(join(license,'NOTICE.txt'),'Runtime notices: yt-dlp (Unlicense, bundled dependencies retain their licenses); Node.js (MIT and bundled notices); CPython standalone (Python license and bundled notices); Codex (Apache-2.0); FFmpeg binary licensing follows ffmpeg-static build (GPL components may apply). Source versions and SHA256 are in tools/manifest.json.\n')
writeFileSync(join(tools,'manifest.json'),JSON.stringify({platform:process.platform,arch:process.arch,preparedAt:new Date().toISOString(),records},null,2)+'\n')
console.log('Prepared runtime tools for '+process.platform+'/'+process.arch)
