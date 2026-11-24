import { afterEach, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { candidates, contactSheet, ensureVideo, extractFrame } from '../src/main/video/media'
import { mediaTool } from '../src/main/imports/tools'
import type { VideoMetadata } from '../src/shared/video'
import { hash } from '../src/main/video/document'
const dirs:string[]=[]
afterEach(()=>{for(const dir of dirs.splice(0))rmSync(dir,{recursive:true,force:true})})
it('extracts actual scene frames at original timestamps and reuses cached media',async()=>{
  const root=mkdtempSync(join(tmpdir(),'video-media-'));dirs.push(root);const dir=join(root,'media');mkdirSync(dir)
  const video=join(dir,'source.mp4'),ffmpeg=mediaTool('ffmpeg'),signal=new AbortController().signal
  execFileSync(ffmpeg,['-nostdin','-y','-v','error','-f','lavfi','-i','color=c=black:s=320x180:d=3:r=5','-f','lavfi','-i','color=c=white:s=320x180:d=3:r=5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264',video])
  const meta:VideoMetadata={url:'https://www.youtube.com/watch?v=abcdefghijk',videoId:'abcdefghijk',title:'fixture',durationMs:6000,startMs:1000,endMs:5500,transcriptSource:'provided'}
  expect(await ensureVideo(dir,meta,signal)).toBe(video)
  const result=await candidates(video,join(root,'candidates'),meta,signal)
  expect(result.frames.length).toBeGreaterThanOrEqual(2);expect(result.frames[0].atMs).toBe(1000);expect(result.frames.some(f=>f.atMs>=2500&&f.atMs<=3500)).toBe(true)
  expect(await candidates(video,join(root,'candidates'),meta,signal)).toEqual(result)
  const sheet=await contactSheet(result.frames,join(root,'sheets'),signal);expect(readFileSync(sheet).length).toBeGreaterThan(1000)
  const frame=await extractFrame(video,3000,join(root,'frames'),signal);expect(frame.sha256).toBe(hash(readFileSync(frame.path)));expect(frame.file).toMatch(/^frame-[a-f0-9]{16}\.jpg$/)
},30000)
it.skipIf(!process.env.YOGURT_REAL_VIDEO)('maps the real video end boundary to exactly the frames written',async()=>{
  const root=mkdtempSync(join(tmpdir(),'video-real-media-'));dirs.push(root)
  const meta:VideoMetadata={url:'https://www.youtube.com/watch?v=ADP3Wo47m6E',videoId:'ADP3Wo47m6E',title:'real end-boundary check',durationMs:1314000,startMs:90000,endMs:120000,transcriptSource:'Whisper'}
  const result=await candidates(process.env.YOGURT_REAL_VIDEO!,join(root,'candidates'),meta,new AbortController().signal)
  expect(result.frames.length).toBeGreaterThan(0);expect(result.frames.every(f=>f.atMs>=90000&&f.atMs<120000)).toBe(true)
  console.log('REAL_FRAME_MAPPING='+JSON.stringify({count:result.frames.length,times:result.frames.map(f=>f.atMs)}))
},30000)
