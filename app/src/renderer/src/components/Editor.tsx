import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {VIDEO_ASSET,videoAssetUrl} from '../../../shared/video'
import { mountDiagram, diagramButton, diagramCopyButton } from './Diagram'

type Mode = 'live' | 'source' | 'read'
const refresh = StateEffect.define<null>()
const diagramSource = StateEffect.define<number | null>()
const diagramCleanup = new WeakMap<HTMLElement, () => void>()

class DiagramPreview extends WidgetType {
  constructor(readonly source:string,readonly code:string,readonly from:number,readonly readOnly:boolean){super()}
  eq(other:DiagramPreview){return other.source===this.source&&other.from===this.from&&other.readOnly===this.readOnly}
  toDOM(view:EditorView){
    const el=document.createElement('figure');el.className='record-diagram markdown-preview-block'
    const toolbar=document.createElement('div');toolbar.className='diagram-toolbar'
    const preview=document.createElement('div');preview.className='record-diagram-preview'
    const raw=document.createElement('pre'),code=document.createElement('code');code.textContent=this.source;raw.append(code);raw.hidden=true
    const toggle=diagramButton('Mermaid 소스 보기', '</>',()=>{
      if(this.readOnly){raw.hidden=!raw.hidden;preview.hidden=!raw.hidden;toggle.setAttribute('aria-pressed',String(!raw.hidden));view.requestMeasure();return}
      const firstLine=this.source.indexOf('\n')+1
      view.dispatch({selection:{anchor:this.from+firstLine},effects:diagramSource.of(this.from)});view.focus()
    });toggle.setAttribute('aria-pressed','false')
    toolbar.append(toggle,diagramCopyButton(this.source));el.append(toolbar,preview,raw)
    diagramCleanup.set(el,mountDiagram(preview,this.code,()=>view.requestMeasure()))
    return el
  }
  destroy(dom:HTMLElement){diagramCleanup.get(dom)?.();diagramCleanup.delete(dom)}
  ignoreEvent(){return true}
}
class DiagramSourceToolbar extends WidgetType {
  constructor(readonly source:string){super()}
  eq(other:DiagramSourceToolbar){return other.source===this.source}
  toDOM(view:EditorView){
    const el=document.createElement('div');el.className='diagram-toolbar diagram-source-toolbar'
    const toggle=diagramButton('다이어그램으로 보기','</>',()=>{view.dispatch({effects:diagramSource.of(null)});view.focus()});toggle.setAttribute('aria-pressed','true')
    el.append(toggle,diagramCopyButton(this.source));return el
  }
  ignoreEvent(){return true}
}
export function renderMarkdown(source:string):string {
  return DOMPurify.sanitize(marked.parse(source,{async:false,gfm:true}) as string,{FORBID_TAGS:['style','iframe','object','form'],FORBID_ATTR:['style']})
}
class RenderedBlock extends WidgetType {
  constructor(readonly source:string,readonly from:number,readonly readOnly:boolean,readonly meetingId?:string){super()}
  eq(other:RenderedBlock){return other.source===this.source&&other.from===this.from&&other.readOnly===this.readOnly&&other.meetingId===this.meetingId}
  toDOM(view:EditorView){
    const el=document.createElement('div');el.className='markdown-preview-block note-prose';el.innerHTML=renderMarkdown(this.source)
    for(const image of el.querySelectorAll('img')) {const file=(image.getAttribute('src')||'').replace(/^assets\//,'');if(this.meetingId&&VIDEO_ASSET.test(file)){image.src=videoAssetUrl(this.meetingId,file);image.loading='lazy'}else image.remove()}
    for(const link of el.querySelectorAll('a')){if(/^https?:\/\//.test(link.href)){link.target='_blank';link.rel='noreferrer noopener'}}
    el.addEventListener('mousedown',e=>{
      if(this.readOnly||(e.target instanceof Element&&e.target.closest('a')))return
      const caret=document.caretRangeFromPoint(e.clientX,e.clientY),leaf=caret?.startContainer.nodeType===globalThis.Node.TEXT_NODE?caret.startContainer.textContent||'':''
      const at=leaf?this.source.indexOf(leaf):-1,offset=at>=0?at+(caret?.startOffset||0):0
      e.preventDefault();view.dispatch({selection:{anchor:Math.min(this.from+offset,view.state.doc.length)},effects:refresh.of(null)});view.focus()
    })
    const cleanup:(()=>void)[]=[]
    for(const code of el.querySelectorAll<HTMLElement>('pre code.language-mermaid')) {
      const figure=document.createElement('figure');figure.className='record-diagram'
      const preview=document.createElement('div');preview.className='record-diagram-preview';figure.append(preview)
      code.parentElement!.replaceWith(figure);cleanup.push(mountDiagram(preview,code.textContent||'',()=>view.requestMeasure()))
    }
    diagramCleanup.set(el,()=>cleanup.forEach(dispose=>dispose()))
    return el
  }
  destroy(dom:HTMLElement){diagramCleanup.get(dom)?.();diagramCleanup.delete(dom)}
  ignoreEvent(){return false}
}
function livePreview(readOnly:boolean,meetingId?:string){
  let cached='',openFrom:number|null=null,blocks:{from:number;to:number;source:string;diagram?:string}[]=[]
  const build=(state:EditorState):DecorationSet=>{
    const text=state.doc.toString()
    if(text!==cached){cached=text;let pos=0;blocks=marked.lexer(text,{gfm:true}).flatMap(token=>{const from=pos;pos+=token.raw.length;return token.type==='space'?[]:[{from,to:pos,source:token.raw,diagram:token.type==='code'&&token.lang?.trim().toLowerCase()==='mermaid'?token.text:undefined}]})}
    const ranges:Range<Decoration>[]=[]
    for(const block of blocks){
      if(block.diagram!==undefined){
        const active=!readOnly&&openFrom===block.from&&state.selection.ranges.some(r=>r.from<block.to&&r.to>=block.from)
        if(active)ranges.push(Decoration.widget({widget:new DiagramSourceToolbar(block.source),block:true,side:-1}).range(block.from))
        else {if(openFrom===block.from)openFrom=null;ranges.push(Decoration.replace({widget:new DiagramPreview(block.source,block.diagram,block.from,readOnly),block:true}).range(block.from,block.to))}
        continue
      }
      const active=!readOnly&&state.selection.ranges.some(r=>r.from<=block.to&&r.to>=block.from)
      if(!active&&block.to>block.from)ranges.push(Decoration.replace({widget:new RenderedBlock(block.source,block.from,readOnly,meetingId),block:true}).range(block.from,block.to))
    }
    return Decoration.set(ranges,true)
  }
  return StateField.define<DecorationSet>({create:build,update:(value,tr)=>{
    if(openFrom!==null&&tr.docChanged)openFrom=tr.changes.mapPos(openFrom)
    for(const effect of tr.effects)if(effect.is(diagramSource))openFrom=effect.value
    return tr.docChanged||tr.selection||tr.effects.some(e=>e.is(refresh)||e.is(diagramSource))?build(tr.state):value
  },provide:f=>EditorView.decorations.from(f)})
}

/** Markdown is the document. Rendering never serializes or rewrites its bytes. */
export function Editor(p:{meetingId?:string;focus?:{match?:string;seq:number};markdown:string;label:string;onChange?:(md:string)=>void;onBlur?:()=>void;editable?:boolean;streaming?:boolean;placeholder?:string;testId:string;className?:string}){
  const parent=useRef<HTMLDivElement>(null),view=useRef<EditorView|undefined>(undefined),callbacks=useRef(p),external=useRef(false)
  const compartment=useRef(new Compartment())
  const modes=(value:Mode,streaming=false)=>[EditorView.editable.of(value!=='read'&&!streaming),EditorState.readOnly.of(value==='read'||streaming),...(value==='source'?[]:[livePreview(value==='read'||streaming,p.meetingId)])]
  callbacks.current=p
  const [mode,setMode]=useState<Mode>(()=>{try{const v=localStorage.getItem('achmage-editor-mode');return v==='source'||v==='read'?v:'live'}catch{return 'live'}})
  const resolved=p.editable===false?'read':mode
  useLayoutEffect(()=>{
    if(!parent.current)return
    const v=new EditorView({parent:parent.current,state:EditorState.create({doc:callbacks.current.markdown,extensions:[
      history(),keymap.of([...defaultKeymap,...historyKeymap,indentWithTab]),markdown({codeLanguages:languages}),EditorView.lineWrapping,
      compartment.current.of(modes(resolved,!!p.streaming)),
      EditorView.contentAttributes.of({'aria-label':p.label,'data-testid':p.testId,'role':'textbox','aria-multiline':'true','spellcheck':'true','dir':'auto'}),
      placeholder(p.placeholder||''),
      EditorView.updateListener.of(u=>{if(u.docChanged&&!external.current)callbacks.current.onChange?.(u.state.doc.toString())}),
      EditorView.domEventHandlers({blur:(_event,editor)=>{callbacks.current.onBlur?.();queueMicrotask(()=>{if(view.current===editor&&!editor.hasFocus&&!editor.dom.contains(document.activeElement))editor.dispatch({effects:diagramSource.of(null)})});return false}}),
    ]})});view.current=v
    return()=>{callbacks.current.onBlur?.();v.destroy();view.current=undefined}
  },[p.testId])
  useLayoutEffect(()=>{view.current?.dispatch({effects:compartment.current.reconfigure(modes(resolved,!!p.streaming))})},[resolved,p.streaming])
  useLayoutEffect(()=>{const v=view.current;if(!v||v.state.doc.toString()===p.markdown)return
    external.current=true
    try{v.dispatch({changes:{from:0,to:v.state.doc.length,insert:p.markdown},selection:{anchor:Math.min(v.state.selection.main.head,p.markdown.length)}})}finally{external.current=false}
  },[p.markdown])
  useEffect(()=>{const v=view.current;if(!v||!p.focus)return
    const at=p.focus.match?v.state.doc.toString().indexOf(p.focus.match):0
    v.dispatch({selection:{anchor:Math.max(0,at)},effects:EditorView.scrollIntoView(Math.max(0,at),{y:'center'})});v.focus()
  },[p.focus?.seq])
  useEffect(()=>{if(!p.meetingId)return;const focus=(event:Event)=>{const d=(event as CustomEvent).detail,v=view.current;if(d?.id!==p.meetingId||!v||!p.testId.includes('enhanced'))return;const at=v.state.doc.toString().indexOf(d.title);if(at>=0){v.dispatch({selection:{anchor:at},effects:EditorView.scrollIntoView(at,{y:'start'})});v.focus()}};window.addEventListener('video:focus',focus);return()=>window.removeEventListener('video:focus',focus)},[p.meetingId,p.testId])
  return <div className={'markdown-editor '+(p.className||'')}>
    {p.editable!==false&&!p.streaming&&<div className="markdown-modebar" role="toolbar" aria-label="Markdown 보기 방식">{(['live','read','source'] as Mode[]).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>{callbacks.current.onBlur?.();setMode(m);localStorage.setItem('achmage-editor-mode',m)}}>{m==='live'?'라이브 편집':m==='read'?'읽기':'원문'}</button>)}<span>자동 저장</span></div>}
    <div ref={parent} data-markdown-mode={resolved}/>
  </div>
}
