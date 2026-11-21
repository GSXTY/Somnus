import { readFileSync } from 'node:fs';
import { replaceExact } from '../overlay.mjs';
import { externalProvider } from './model-provider-route.mjs';

function modelSource(provider) {
  return provider && externalProvider({ id: provider }) ? provider : 'api';
}

function modelSourceTabs(groups, failures) {
  const tabs = [{ id: 'api', name: 'Somnus API' }];
  const listed = new Set();
  for (const group of [...groups, ...failures]) {
    if (externalProvider(group) && !listed.has(group.id)) {
      tabs.push({ id: group.id, name: group.provider?.name ?? group.name });
      listed.add(group.id);
    }
  }
  return tabs;
}

function focusCurrentModelSource(menu) {
  const selected = menu?.querySelector('[role="tab"][aria-selected="true"]');
  selected?.focus();
  return selected !== null && selected !== undefined;
}

function renderModelSourceTabs(id, tabs, active, choose, focusOptions, label) {
  const { jsx, jsxs } = react_jsx_runtime;
  return jsx('div', {
    className: 'somnus-model-source-tabs', role: 'tablist', 'aria-label': label,
    children: tabs.map((source, index) => {
      const isApi = source.id === 'api';
      const title = isApi ? source.name : `${source.name} · ACP`;
      return jsxs('button', {
        type: 'button', role: 'tab', id: `${id}-source-${index}`, title,
        className: 'somnus-model-source-tab', 'aria-controls': `${id}-source-panel`,
        'aria-selected': index === active, tabIndex: index === active ? 0 : -1,
        onClick: event => { choose(source.id); event.currentTarget.focus(); },
        onKeyDown: event => {
          if (event.nativeEvent.isComposing) return;
          const { key, currentTarget } = event;
          if (key === 'ArrowDown' || key === 'ArrowUp') {
            event.preventDefault();
            focusOptions();
            return;
          }
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(key)) return;
          event.preventDefault();
          const offset = key === 'ArrowRight' ? 1 : -1;
          const next = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
          choose(tabs[next].id);
          currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus();
        },
        children: [jsx('span', { children: source.name }), isApi ? null : jsx('span', { children: 'ACP' })],
      }, source.id);
    }),
  });
}

// Patch the pinned selector rather than replacing its session, effort, or selection logic.
export function nativeModelSourceTabs(source, file) {
  const css = readFileSync(new URL('./native-model-source-tabs.css', import.meta.url), 'utf8');
  const modelPane = 'pane===`model`&&(0,react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment,{children:[showSearch';
  const endModelPane = 'children:t(choices.length===0?`empty.models`:`search.empty`)})]}),pane===`effort`';
  const patches = [
    ['const css=`', `const css=${JSON.stringify(css)}+\``],
    ['function ModelSelect(', `${[externalProvider, modelSource, modelSourceTabs, focusCurrentModelSource, renderModelSourceTabs].map(fn => fn.toString()).join('\n')}\nfunction ModelSelect(`],
    ['const[query,setQuery]=(0,react.useState)(``);', 'const[query,setQuery]=(0,react.useState)(``);const[chosenSource,setChosenSource]=(0,react.useState)(null);'],
    ['const showSearch=choices.length>4;', `
const sourceTabs=(0,react.useMemo)(()=>modelSourceTabs(groups,state.failures),[groups,state.failures]);
const currentSource=modelSource(state.current?.provider);
const activeSourceIndex=Math.max(0,sourceTabs.findIndex(source=>source.id===(chosenSource??currentSource)));
const activeSource=sourceTabs[activeSourceIndex].id;
const sourceGroups=(0,react.useMemo)(()=>groups.filter(group=>modelSource(group.id)===activeSource),[groups,activeSource]);
const showSearch=sourceGroups.reduce((count,group)=>count+group.models.length,0)>4;
const chooseSource=next=>{if(next!==activeSource){setChosenSource(next);setQuery(\`\`);setHighlightedIndex(null)}};
const focusModelOptions=()=>{
  if(showSearch){searchRef.current?.focus();return}
  const selected=menuRef.current?.querySelector('[role="menuitemradio"][aria-checked="true"]:not([disabled])');
  (selected??itemRefs.current.find(item=>item!==null&&!item.disabled))?.focus();
};
`],
    ['()=>groups.map(group=>({...group,models:', '()=>sourceGroups.map(group=>({...group,models:'],
    ['[groups,query,showSearch]);const visibleModels=', '[sourceGroups,query,showSearch]);const visibleModels='],
    ['if(intent===`drill`){if(pane===`model`&&showSearch&&!(0,_deepseek_ai_dsh_client_ui_primitives.isMobileDevice)()){searchRef.current?.focus();return}', 'if(intent===`drill`){if(pane===`model`&&focusCurrentModelSource(menuRef.current))return;'],
    ['const show=()=>{setSelectionFocus(false);', 'const show=()=>{setChosenSource(null);setSelectionFocus(false);'],
    ['const drill=next=>{setQuery(``);', 'const drill=next=>{if(next===`model`)setChosenSource(null);setQuery(``);'],
    ['const onRootKeyDown=event=>{if(event.nativeEvent.isComposing)return;', 'const onRootKeyDown=event=>{if(event.defaultPrevented||event.nativeEvent.isComposing)return;'],
    ['if(event.key===`Tab`){if(event.shiftKey){event.preventDefault();', 'if(event.key===`Tab`){if(event.shiftKey){if(pane===`model`&&event.target instanceof Element&&event.target.closest(\'[role="tabpanel"]\')!==null&&focusCurrentModelSource(menuRef.current)){event.preventDefault();return}event.preventDefault();'],
    ['className:ModelSelect_module_css_default.menu,style:anchorStyle,', 'className:clsx(ModelSelect_module_css_default.menu,pane===`model`&&`somnus-model-source-menu`),style:anchorStyle,'],
    [modelPane, 'pane===`model`&&(0,react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment,{children:[renderModelSourceTabs(id,sourceTabs,activeSourceIndex,chooseSource,focusModelOptions,t(`menu.model`)),(0,react_jsx_runtime.jsxs)(`div`,{className:`somnus-model-source-panel`,role:`tabpanel`,id:`${id}-source-panel`,"aria-labelledby":`${id}-source-${activeSourceIndex}`,children:[showSearch'],
    ['state.failures.map(failure=>', 'state.failures.filter(failure=>modelSource(failure.id)===activeSource).map(failure=>'],
    [endModelPane, 'children:t(sourceGroups.every(group=>group.models.length===0)?`empty.models`:`search.empty`)})]})]}),pane===`effort`'],
  ];
  return patches.reduce((current, [anchor, replacement]) => replaceExact(current, anchor, replacement, file), source);
}
