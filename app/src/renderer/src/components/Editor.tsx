import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, keymap, placeholder, type DecorationSet } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

type Mode = 'live' | 'source' | 'read'
const refresh = StateEffect.define<null>()
let diagramSerial=0
export function renderMarkdown(source:string):string {
  return DOMPurify.sanitize(marked.parse(source,{async:false,gfm:true}) as string,{FORBID_TAGS:['style','iframe','object','form'],FORBID_ATTR:['style']})
}
class RenderedBlock extends WidgetType {
  constructor(readonly source:string,readonly from:number,readonly readOnly:boolean){super()}
  eq(other:RenderedBlock){return other.source===this.source&&other.from===this.from&&other.readOnly===this.readOnly}
  toDOM(view:EditorView){
    const el=document.createElement('div');el.className='markdown-preview-block note-prose';el.innerHTML=renderMarkdown(this.source)
    el.addEventListener('mousedown',e=>{
      if(this.readOnly)return
      const caret=document.caretRangeFromPoint(e.clientX,e.clientY),leaf=caret?.startContainer.nodeType===globalThis.Node.TEXT_NODE?caret.startContainer.textContent||'':''
      const at=leaf?this.source.indexOf(leaf):-1,offset=at>=0?at+(caret?.startOffset||0):0
      e.preventDefault();view.dispatch({selection:{anchor:Math.min(this.from+offset,view.state.doc.length)},effects:refresh.of(null)});view.focus()
    })
    for(const code of el.querySelectorAll<HTMLElement>('pre code.language-mermaid')) {
      const source=code.textContent||'', pre=code.parentElement!
      if(source.length>20000||/%%\{|^\s*(?:click|style|classDef|linkStyle)\b|<\/?[a-z]|https?:\/\//im.test(source))continue
      void import('mermaid').then(async({default:mermaid})=>{
        mermaid.initialize({startOnLoad:false,securityLevel:'strict',suppressErrorRendering:true,theme:document.documentElement.dataset.mode==='dark'?'dark':'neutral',flowchart:{htmlLabels:false}})
        const {svg}=await mermaid.render('achmage-md-'+(++diagramSerial),source)
        if(pre.isConnected){const figure=document.createElement('figure');figure.className='record-diagram';figure.innerHTML=DOMPurify.sanitize(svg,{USE_PROFILES:{svg:true,svgFilters:true}});pre.replaceWith(figure)}
      }).catch(()=>{/* Keep the source visible if a diagram cannot render. */})
    }
    return el
  }
  ignoreEvent(){return false}
}
function livePreview(readOnly:boolean){
  let cached='',blocks:{from:number;to:number;source:string}[]=[]
  const build=(state:EditorState):DecorationSet=>{
    const text=state.doc.toString()
    if(text!==cached){cached=text;let pos=0;blocks=marked.lexer(text,{gfm:true}).flatMap(token=>{const from=pos;pos+=token.raw.length;return token.type==='space'?[]:[{from,to:pos,source:token.raw}]})}
    const ranges:Range<Decoration>[]=[]
    for(const block of blocks){
      const active=!readOnly&&state.selection.ranges.some(r=>r.from<=block.to&&r.to>=block.from)
      if(!active&&block.to>block.from)ranges.push(Decoration.replace({widget:new RenderedBlock(block.source,block.from,readOnly),block:true}).range(block.from,block.to))
    }
    return Decoration.set(ranges,true)
  }
  return StateField.define<DecorationSet>({create:build,update:(value,tr)=>tr.docChanged||tr.selection||tr.effects.some(e=>e.is(refresh))?build(tr.state):value,provide:f=>EditorView.decorations.from(f)})
}

/** Markdown is the document. Rendering never serializes or rewrites its bytes. */
export function Editor(p:{focus?:{match?:string;seq:number};markdown:string;label:string;onChange?:(md:string)=>void;onBlur?:()=>void;editable?:boolean;streaming?:boolean;placeholder?:string;testId:string;className?:string}){
  const parent=useRef<HTMLDivElement>(null),view=useRef<EditorView|undefined>(undefined),callbacks=useRef(p),external=useRef(false)
  const compartment=useRef(new Compartment())
  const modes=(value:Mode,streaming=false)=>[EditorView.editable.of(value!=='read'&&!streaming),EditorState.readOnly.of(value==='read'||streaming),...(value==='source'?[]:[livePreview(value==='read'||streaming)])]
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
      EditorView.domEventHandlers({blur:()=>{callbacks.current.onBlur?.();return false}}),
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
  return <div className={'markdown-editor '+(p.className||'')}>
    {p.editable!==false&&!p.streaming&&<div className="markdown-modebar" role="toolbar" aria-label="Markdown 보기 방식">{(['live','read','source'] as Mode[]).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>{callbacks.current.onBlur?.();setMode(m);localStorage.setItem('achmage-editor-mode',m)}}>{m==='live'?'라이브 편집':m==='read'?'읽기':'원문'}</button>)}<span>자동 저장</span></div>}
    <div ref={parent} data-markdown-mode={resolved}/>
  </div>
}
