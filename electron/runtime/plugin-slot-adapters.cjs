// Verified against fixed Next f2483c6 cordis-client-runner slot-catalog.ts.
// An adapter consumes an owned safe document/page, never the upstream React callback.
const ADAPTERS=Object.freeze({
 settings:{slot:'settings',renderers:['declarative','page']},
 sidebar:{slot:'sidebar',renderers:['declarative','page']},
 'chat-card':{slot:'chat-card',renderers:['declarative']},
 'settings.general.item':{slot:'settings',renderers:['declarative','page'],upstreamLine:3444},
 'settings.section':{slot:'settings',renderers:['declarative','page'],upstreamLine:3844},
 'sidebar.panellist':{slot:'sidebar',renderers:['declarative','page'],upstreamLine:4362},
 'sidebar.right.pane.tab':{slot:'sidebar',renderers:['declarative','page'],upstreamLine:4471},
 'conversation.chat.turnTail':{slot:'chat-card',renderers:['declarative'],upstreamLine:668},
});
function slotAdapter(name,renderer){const adapter=ADAPTERS[name];return adapter&&adapter.renderers.includes(renderer)?adapter:null;}
function summarize(rows){const ready=rows.filter(row=>row.compatibility==='ready'),missing=rows.filter(row=>row.compatibility!=='ready');return{status:ready.length?(missing.length?'partial':'ready'):'adapter-required',verifiedExtensions:ready.length,supportedSlots:[...new Set(ready.map(row=>row.sourceSlot||row.slot))],reasons:[...new Set(missing.map(row=>row.reason).filter(Boolean))],scope:'已验证的安全文档或独立页面；不执行原厂React组件回调。',upstream:'f2483c6'};}
module.exports={ADAPTERS,slotAdapter,summarize};
