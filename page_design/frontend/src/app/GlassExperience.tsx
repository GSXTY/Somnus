import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, PointerEvent } from 'react';
import { Button, Input, Modal } from 'antd';
import { AppstoreOutlined, BarChartOutlined, ArrowRightOutlined, BellOutlined, CloseOutlined, DashboardOutlined, DatabaseOutlined, ExperimentOutlined, ExpandOutlined, RobotOutlined, SearchOutlined, SettingOutlined, TeamOutlined, CloudServerOutlined, DownOutlined } from '@ant-design/icons';
import { commands, filterCommands, highlightParts, tiltAt, dockScale } from './glassLogic.mjs';
import { dockKeys, navigation } from './navigation.mjs';

export const GlassContext = createContext({ enabled:false, focus:'', setFocus: (_id:string)=>{} });
export const moduleNames = [{id:'metrics',label:'关键指标'},{id:'activity',label:'活跃与治疗'},{id:'events',label:'事件趋势'},{id:'users',label:'巡检对象'},{id:'quality',label:'数据完整性'},{id:'insights',label:'巡检洞察'}];
const iconFor:Record<string,ReactNode>={mcp:<AppstoreOutlined/>,dashboard:<DashboardOutlined/>,assistant:<RobotOutlined/>,sql:<DatabaseOutlined/>,analysis:<ExperimentOutlined/>,'deep-analysis':<BarChartOutlined/>,users:<TeamOutlined/>,devices:<CloudServerOutlined/>,alerts:<BellOutlined/>,settings:<SettingOutlined/>};
export function FocusModule({id,children,tilt=true,className=''}:{id:string;children:ReactNode;tilt?:boolean;className?:string}) {
 const {enabled,focus,setFocus}=useContext(GlassContext), node=useRef<HTMLDivElement>(null);
 function move(event:PointerEvent<HTMLDivElement>){if(!enabled||focus||event.pointerType!=='mouse'||window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse)').matches)return;const box=event.currentTarget.getBoundingClientRect(), x=event.clientX-box.left,y=event.clientY-box.top; const target=node.current;if(!target)return;target.style.setProperty('--glow-x',`${x}px`);target.style.setProperty('--glow-y',`${y}px`);const rotation=tiltAt(x,y,box.width,box.height);target.style.setProperty('--tilt-x',tilt?`${rotation.x}deg`:'0deg');target.style.setProperty('--tilt-y',tilt?`${rotation.y}deg`:'0deg');}
 function reset(){node.current?.style.setProperty('--tilt-x','0deg');node.current?.style.setProperty('--tilt-y','0deg');}
 const lastRect=useRef<DOMRect>(),lastFocusRect=useRef<DOMRect>(),previousFocused=useRef(false);
 useLayoutEffect(()=>{const target=node.current;if(!target)return;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;const now=target.getBoundingClientRect(),was=previousFocused.current,is=focus===id;if(is&&!was&&lastRect.current&&!reduced){const old=lastRect.current;target.animate([{translate:`${old.left-now.left}px ${old.top-now.top}px`,scale:`${old.width/now.width} ${old.height/now.height}`,transformOrigin:'top left',opacity:.7},{translate:'0px 0px',scale:'1 1',transformOrigin:'top left',opacity:1}],{duration:420,easing:'cubic-bezier(.2,.9,.3,1)'});}if(!is&&was&&!reduced&&lastFocusRect.current){const old=lastFocusRect.current;target.animate([{translate:`${old.left-now.left}px ${old.top-now.top}px`,scale:`${old.width/now.width} ${old.height/now.height}`,transformOrigin:'top left',opacity:.65},{translate:'0px 0px',scale:'1 1',transformOrigin:'top left',opacity:1}],{duration:340,easing:'cubic-bezier(.2,.9,.3,1)'});}if(is)lastFocusRect.current=now;if(!is)lastRect.current=now;previousFocused.current=is;},[focus,id]);
 const title=moduleNames.find(m=>m.id===id)?.label||id;
 return <section className={`focus-module ${className} ${focus===id?'module-focused':''}`} data-module={id} style={focus===id&&lastRect.current?{minHeight:lastRect.current.height}:undefined}><div ref={node} className={`module-surface ${tilt?'tiltable':''}`} onPointerMove={move} onPointerLeave={reset}>{children}{enabled&&<button type="button" className="module-expand" aria-label={focus===id?`收起${title}`:`放大${title}`} onClick={()=>setFocus(focus===id?'':id)}>{focus===id?<CloseOutlined/>:<ExpandOutlined/>}</button>}</div></section>;
}
export function FocusRail(){const {focus,setFocus}=useContext(GlassContext);if(!focus)return null;return <><div className="module-focus-backdrop" onClick={()=>setFocus('')}/><div className="module-focus-caption"><AppstoreOutlined/>专注视图 <span>Esc 收起</span></div><nav className="module-thumb-rail" aria-label="切换放大模块">{moduleNames.filter(item=>Boolean(document.querySelector(`[data-module="${item.id}"]`))).map((item,index)=><button key={item.id} type="button" aria-pressed={item.id===focus} onClick={()=>setFocus(item.id)}><span className="thumb-glyph">{index===0?'▥':index===3?'☷':index===4?'◉':'⌁'}</span><span>{item.label}</span></button>)}<button type="button" aria-label="关闭专注视图" onClick={()=>setFocus('')}><CloseOutlined/></button></nav></>;}
export function GlassNav({view,onChange,group}:{view:string;onChange:(key:string)=>void;group?:string}){
  const nav=useRef<HTMLElement>(null);
  const [capsuleTop,setCapsuleTop]=useState(0);
  useEffect(()=>{const target=nav.current;if(!target||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;target.classList.remove('moving');void target.offsetWidth;target.classList.add('moving');},[view]);
  useLayoutEffect(()=>{const active=nav.current?.querySelector('button[aria-current="page"]') as HTMLElement|null;setCapsuleTop(active&&nav.current?active.offsetTop:0);},[view]);
  return <nav ref={nav} className="liquid-nav" aria-label="工作台导航"><span className="liquid-nav-capsule" style={{transform:`translateY(${capsuleTop}px)`} as CSSProperties}/>{navigation.filter(section=>!group||section.key===group).map(group=><Fragment key={group.key}><div className="liquid-nav-group">{group.label}</div>{group.items.map(item=><button key={item.key} type="button" aria-current={view===item.key?'page':undefined} aria-label={item.label} title={item.label} onClick={()=>onChange(item.key)}>{iconFor[item.key]}<span>{item.label}</span></button>)}</Fragment>)}</nav>;
}

export function GlassFilter({label,value,options,onChange}:{label:string;value:string;options:{value:string;label:string}[];onChange:(value:string)=>void}){const [open,setOpen]=useState(false),area=useRef<HTMLDivElement>(null);useEffect(()=>{if(!open)return;const close=(event:globalThis.PointerEvent)=>{if(!area.current?.contains(event.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[open]);return <div className={`liquid-filter ${open?'filter-open':''}`} ref={area} onKeyDown={event=>{if(event.key==='Escape')setOpen(false);}}><button type="button" aria-label={label} aria-expanded={open} onClick={()=>setOpen(!open)}>{options.find(o=>o.value===value)?.label}<DownOutlined/></button>{open&&<div className="liquid-filter-options" role="group" aria-label={`${label}选项`}>{options.map((option,index)=><button type="button" key={option.value} style={{'--option-index':index} as CSSProperties} aria-pressed={option.value===value} onClick={()=>{onChange(option.value);setOpen(false);}}>{option.label}{value===option.value&&<span>✓</span>}</button>)}</div>}</div>;}
export function RollingNumber({value,precision=0}:{value:number|null;precision?:number}){const {enabled}=useContext(GlassContext),[current,setCurrent]=useState(value),previous=useRef(value);useEffect(()=>{const from=previous.current;previous.current=value;if(!enabled||from===null||value===null||from===value||window.matchMedia('(prefers-reduced-motion: reduce)').matches){setCurrent(value);return;}let frame=0,start=performance.now();function tick(now:number){const t=Math.min(1,(now-start)/460);setCurrent(from!+(value!-from!)*(1-Math.pow(1-t,3)));if(t<1)frame=requestAnimationFrame(tick);}frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[value,enabled]);return <span className="rolling-value" aria-label={value===null?'未知':value.toFixed(precision)}>{value===null||current===null?'—':current.toLocaleString('en-US',{minimumFractionDigits:precision,maximumFractionDigits:precision})}</span>;}
export function CommandPanel({open,onClose,onNavigate}:{open:boolean;onClose:()=>void;onNavigate:(key:string)=>void}){const [query,setQuery]=useState(''),[index,setIndex]=useState(0),input=useRef<import('antd').InputRef>(null);const results=filterCommands(query);useEffect(()=>{if(open){setQuery('');setIndex(0);const id=setTimeout(()=>input.current?.focus(),30);return()=>clearTimeout(id);}},[open]);function navigate(key:string){onClose();onNavigate(key);}return <Modal open={open} onCancel={onClose} footer={null} closable={false} width={620} className="glass-command" style={{top:'18vh'}} destroyOnClose><div className="command-search"><SearchOutlined/><Input ref={input} aria-label="搜索功能" placeholder="搜索页面或功能…" value={query} onChange={event=>{setQuery(event.target.value);setIndex(0);}} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='ArrowDown'){event.preventDefault();setIndex(Math.min(index+1,results.length-1));}if(event.key==='ArrowUp'){event.preventDefault();setIndex(Math.max(0,index-1));}if(event.key==='Enter'&&results[index]){event.preventDefault();navigate(results[index].key);}}}/><kbd>Esc</kbd></div><div className="command-results" role="listbox" aria-label="功能搜索结果">{results.length?results.map((item,i)=><button key={item.key} type="button" role="option" aria-selected={index===i} onMouseEnter={()=>setIndex(i)} onClick={()=>navigate(item.key)}>{iconFor[item.key]}<span><strong>{highlightParts(item.label,query).map((part,j)=>part.match?<mark key={j}>{part.text}</mark>:<span key={j}>{part.text}</span>)}</strong><small>{item.hint}</small></span><ArrowRightOutlined/></button>):<p className="command-empty">没有匹配的功能，试试“分析”或“用户”。</p>}</div><div className="command-footer">↑ ↓ 选择 <span>Enter 打开</span><Button type="text" size="small" onClick={onClose}>关闭</Button></div></Modal>;}
export function GlassDock({ view, onNavigate, onCommand }: {
  view: string;
  onNavigate: (key: string) => void;
  onCommand: () => void;
}) {
  const [hover, setHover] = useState(-1);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('ya70.dock.collapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('ya70.dock.collapsed', collapsed ? '1' : '0');
    } catch { /* Storage is optional. */ }
  }, [collapsed]);
  const dockItems = dockKeys
    .map(key => commands.find((item: { key: string }) => item.key === key))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const items = [...dockItems, { key: 'command', label: '搜索功能', hint: '搜索页面与操作', group: '快捷' }];
  const toggleLabel = collapsed ? '展开停靠栏' : '收起停靠栏';

  return <nav className="glass-dock" aria-label="快捷停靠栏" onMouseLeave={() => setHover(-1)}>
    <div className="glass-dock-links" id="glass-dock-links" hidden={collapsed}>
      {items.map((item, index) => <button
        type="button"
        key={item.key}
        aria-label={item.label}
        title={item.label}
        aria-current={view === item.key ? 'page' : undefined}
        onMouseEnter={() => setHover(index)}
        onFocus={() => setHover(index)}
        onBlur={() => setHover(-1)}
        onClick={() => item.key === 'command' ? onCommand() : onNavigate(item.key)}
        style={{ '--dock-scale': dockScale(index, hover) } as CSSProperties}
      >
        {item.key === 'command' ? <SearchOutlined /> : iconFor[item.key]}
      </button>)}
    </div>
    <button
      type="button"
      className="glass-dock-toggle"
      aria-label={toggleLabel}
      aria-expanded={!collapsed}
      aria-controls="glass-dock-links"
      title={toggleLabel}
      onClick={() => { setHover(-1); setCollapsed(value => !value); }}
    ><DownOutlined /></button>
  </nav>;
}
