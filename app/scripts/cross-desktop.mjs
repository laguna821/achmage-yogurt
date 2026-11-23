// Unsigned Windows x64 / macOS arm64 bundles from Linux, without Actions minutes.
// Capture helpers are byte-for-byte assets from the matching MIT upstream release.
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {chmodSync,copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL??='1'
const require=createRequire(import.meta.url),root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const platform=process.argv[2],arch=platform==='darwin'?'arm64':'x64'
if(!['win32','darwin'].includes(platform))throw new Error('Usage: node scripts/cross-desktop.mjs win32|darwin /absolute/staging [--prepare-only]')
const stage=resolve(process.argv[3]),res=join(stage,'resources'),cache=join(stage,'downloads'),tools=join(res,'tools'),win=platform==='win32',suffix=win?'.exe':'',records=[]
for(const p of [res,cache,tools])mkdirSync(p,{recursive:true})
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex')
const run=(p,args)=>execFileSync(p,args,{stdio:'inherit'})
const fetchOk=async url=>{const r=await fetch(url,{headers:{'User-Agent':'Achmage-Yogurt-build'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r}
async function download(url,name,sha){const p=join(cache,name);if(existsSync(p)&&hash(p)===sha)return p;const b=Buffer.from(await(await fetchOk(url)).arrayBuffer());if(createHash('sha256').update(b).digest('hex')!==sha)throw new Error('Checksum mismatch '+name);writeFileSync(p,b);return p}
const release=async(repo,tag='latest')=>(await fetchOk(`https://api.github.com/repos/${repo}/releases/${tag==='latest'?'latest':'tags/'+tag}`)).json()
async function asset(r,name){const a=r.assets.find(a=>a.name===name);if(!a?.digest?.startsWith('sha256:'))throw new Error('No verified asset '+name);records.push({name,source:a.browser_download_url,sha256:a.digest.slice(7)});return download(a.browser_download_url,name,a.digest.slice(7))}
function tool(src,name){copyFileSync(src,join(tools,name+suffix));if(!win)chmodSync(join(tools,name+suffix),0o755)}
// Each platform gets its own resources; the host runtimes are never overwritten.
for(const n of ['achmage-transcript','licenses','about'])cpSync(join(root,'resources',n),join(res,n),{recursive:true})
const upstream=await release('FrigadeHQ/yogurt','v0.3.38')
const native=await asset(upstream,win?'Yogurt-windows-x64.exe':'Yogurt-mac-arm64.zip')
const unpack=join(stage,'upstream');mkdirSync(unpack,{recursive:true})
if(!existsSync(join(res,'bin'))){
  let source
  if(win){
    const search=join(process.env.HOME||'','./.cache/electron-builder/7zip@1.0.0')
    const z=process.env.SEVEN_ZIP||readdirSync(search).map(n=>join(search,n,'bin/7zz')).find(existsSync)
    if(!z)throw new Error('Set SEVEN_ZIP to a 7zz executable')
    run(z,['x','-y',native,'-o'+unpack]);const archive=join(unpack,'$PLUGINSDIR/app-64.7z');run(z,['x','-y',archive,'-o'+join(unpack,'app'),'resources/*']);source=join(unpack,'app/resources')
  }else{run('unzip',['-q','-o',native,'Yogurt.app/Contents/Resources/*','-d',unpack]);source=join(unpack,'Yogurt.app/Contents/Resources')}
  for(const n of ['bin','vad',...(win?['dict','speed']:[])])if(existsSync(join(source,n)))cpSync(join(source,n),join(res,n),{recursive:true})
  if(existsSync(join(source,'licenses')))cpSync(join(source,'licenses'),join(res,'licenses/upstream-native'),{recursive:true})
}
const ff=await release('eugeneware/ffmpeg-static','b6.1.1'),gz=await asset(ff,`ffmpeg-${platform}-${arch}.gz`)
writeFileSync(join(tools,'ffmpeg'+suffix),gunzipSync(readFileSync(gz)));if(!win)chmodSync(join(tools,'ffmpeg'),0o755)
const license=join(res,'licenses/runtime-tools');mkdirSync(license,{recursive:true})
for(const ext of ['LICENSE','README']){const name=`${platform}-${arch}.${ext}`;copyFileSync(await asset(ff,name),join(license,'ffmpeg-'+name))}
tool(join(dirname(require.resolve('ffprobe-static/package.json')),'bin',platform,arch,'ffprobe'+suffix),'ffprobe')
const nodes=await(await fetchOk('https://nodejs.org/dist/index.json')).json(),node=nodes.find(v=>v.version.startsWith('v24.'))
const nodeName=`node-${node.version}-${platform==='win32'?'win':platform}-${arch}.${win?'zip':'tar.gz'}`,nodeBase=`https://nodejs.org/dist/${node.version}`
const sums=await(await fetchOk(nodeBase+'/SHASUMS256.txt')).text(),nodeSha=sums.split('\n').find(l=>l.trim().endsWith('  '+nodeName))?.trim().split(/\s+/)[0]
if(!nodeSha)throw new Error('Node checksum missing');const nodeArchive=await download(nodeBase+'/'+nodeName,nodeName,nodeSha)
const nodeDir=join(stage,'node');mkdirSync(nodeDir,{recursive:true});if(win)run('unzip',['-q','-o',nodeArchive,'-d',nodeDir]);else run('tar',['-xzf',nodeArchive,'-C',nodeDir])
const nodeRoot=join(nodeDir,nodeName.replace(/\.(zip|tar.gz)$/,''));tool(join(nodeRoot,win?'node.exe':'bin/node'),'node');copyFileSync(join(nodeRoot,'LICENSE'),join(license,'NODE-LICENSE'));records.push({name:'node',source:nodeBase+'/'+nodeName,sha256:nodeSha})
const yt=await release('yt-dlp/yt-dlp');tool(await asset(yt,win?'yt-dlp.exe':'yt-dlp_macos'),'yt-dlp')
const py=await release('astral-sh/python-build-standalone'),triple=win?'x86_64-pc-windows-msvc':'aarch64-apple-darwin'
const pyName=py.assets.find(a=>a.name.startsWith('cpython-3.13.')&&a.name.includes(triple+'-install_only')&&a.name.endsWith('-install_only_stripped.tar.gz'))?.name
run('tar',['-xzf',await asset(py,pyName),'-C',res])
const codexName=`@openai/codex-${win?'win32-x64':'darwin-arm64'}`,codex=join(stage,'codex');mkdirSync(codex,{recursive:true})
const packedResult=JSON.parse(execFileSync('npm',['pack','@openai/codex@0.171.0-'+(win?'win32-x64':'darwin-arm64'),'--pack-destination',cache,'--json'],{encoding:'utf8'}));const packed=Array.isArray(packedResult)?packedResult[0]:Object.values(packedResult)[0]
run('tar',['-xzf',join(cache,packed.filename),'-C',codex]);const vendor=join(codex,'package/vendor'),trg=readdirSync(vendor)[0]
cpSync(join(vendor,trg,'bin'),tools,{recursive:true});records.push({name:'codex',source:'@openai/codex@0.171.0-'+(win?'win32-x64':'darwin-arm64'),integrity:packed.integrity,sha256:hash(join(tools,'codex'+suffix))})
cpSync(join(root,'resources/pdf'),join(res,'pdf'),{recursive:true})
writeFileSync(join(tools,'manifest.json'),JSON.stringify({platform,arch,preparedAt:new Date().toISOString(),upstreamNative:'v0.3.38',records},null,2)+'\n')
if(!process.argv.includes('--prepare-only')){
  const {build,Platform,Arch}=require('electron-builder'),yaml=require('js-yaml'),config=yaml.load(readFileSync(join(root,'electron-builder.yml'),'utf8'))
  config.afterPack=join(root,'scripts/linux-launcher.cjs');config.directories.buildResources=join(root,'build');config.directories.output=join(root,'dist');config.mac.icon=join(root,'build/icon.icns');config.win.icon=join(root,'build/icon.ico');process.chdir(root)
  config.extraResources=config.extraResources.map(e=>({...e,from:existsSync(join(res,e.from.replace(/^resources\//,'')))?join(res,e.from.replace(/^resources\//,'')):join(root,e.from)}))
  if(win)config.win.extraResources=config.win.extraResources.map(e=>({...e,from:e.from==='resources'?join(root,'resources'):join(res,e.from.replace(/^resources\//,''))}))
  // Linux cannot re-sign a changed Mach-O; leave Electron's stock binary untouched.
  // This is an unsigned ZIP, with no signing/notarization invocation.
  if(!win)delete config.electronFuses
  const configPath=join(stage,'builder.json');writeFileSync(configPath,JSON.stringify(config,null,2))
  await build({projectDir:root,targets:(win?Platform.WINDOWS:Platform.MAC).createTarget(win?'nsis':'zip',win?Arch.x64:Arch.arm64),publish:'never',config:configPath})
}
console.log(`Prepared ${platform}/${arch}: ${stage}`)
