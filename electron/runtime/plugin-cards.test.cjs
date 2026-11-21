const test=require('node:test'),assert=require('node:assert/strict');
const {NativeDshChat}=require('../acp-native-dsh-chat.cjs'),{toolCatalog}=require('../acp-mcp.cjs'),{TaskTrace}=require('./trace.cjs');
test('tool cards require authenticated catalog ownership and persist only safe presentation with real outcome',async()=>{
 let presentation={plugin_id:'plugin-owner',document:{version:1,blocks:[{type:'text',text:'Synthetic tool card'}]}};
 const chat=new NativeDshChat({}, {tool:async()=>({content:[{type:'text',text:'SYNTHETIC-TOOL-RESULT'}],somnus_ui:presentation})},{});
 const events=[],turn={agentId:'agent',conversationId:'a'.repeat(32),turnId:'b'.repeat(32),extensions:new Map(toolCatalog([{name:'mcp__synthetic__read',inputSchema:{type:'object'},trusted_plugin_id:'plugin-owner'}]).map(tool=>[tool.name,tool])),toolCalls:0,activeTools:0,onUpdate:event=>events.push(event)};
 const invoke=()=>chat.extensionTool(turn,{name:'mcp__synthetic__read',arguments:{}},new AbortController().signal);
 await invoke();assert.equal(events.filter(event=>event.pluginCard).length,1);const trace=new TaskTrace('dsh-native');for(const event of events)trace.update(event);assert.equal(trace.finish({text:'done',stopReason:'end_turn'}).plugin_cards[0].pluginId,'plugin-owner');
 presentation={...presentation,plugin_id:'forged-other-owner'};await invoke();assert.equal(events.filter(event=>event.pluginCard).length,1);
 presentation={plugin_id:'plugin-owner',document:{version:1,blocks:[{type:'text',text:'bad\ud800'}]}};await invoke();assert.equal(events.filter(event=>event.pluginCard).length,1);assert.equal(turn.activeTools,0);
});
