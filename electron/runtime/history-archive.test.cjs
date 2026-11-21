const test=require('node:test');const assert=require('node:assert/strict');const {createHash}=require('node:crypto');
const {archiveChildHistory,fragments}=require('./history-archive.cjs');
test('large Unicode message fragments preserve text and fit strict JSON page budgets',async()=>{
 const content=('中文🙂\"\n').repeat(25000),records=Array.from({length:125},(_,i)=>({event:{seq:i+1,type:i%2?'user/message':'assistant/message',data:i%2?{content:[{type:'text',text:i===123?content:'m'+i}]}:{message:{content:[{type:'text',text:'m'+i}]}}}}));
 const pages=[];let calls=0;
 await archiveChildHistory({call:async(_,{beforeSeq=126})=>{calls++;const rows=records.filter(r=>r.event.seq<beforeSeq).slice(-100);return{records:rows,hasMore:rows[0]?.event.seq>1};},range:{after:0,parentId:'parent',mode:'fork'},sessionId:'child',atSeq:125,reservationId:'rid',client:{archiveNativeForkPage:async(_,body)=>{assert.ok(Buffer.byteLength(JSON.stringify(body))<=65536);pages.push(body);}},validate(){},redact:x=>x});
 assert.equal(calls,2);assert.equal(pages.at(-1).done,true);
 const combined=pages.flatMap(p=>p.records).filter(r=>r.seq===124).sort((a,b)=>a.part-b.part).map(r=>r.content).join('');
 assert.equal(combined,content);assert.equal(pages.flatMap(p=>p.records).filter(r=>r.final).length,125);
 assert.equal(createHash('sha256').update(combined).digest('hex'),createHash('sha256').update(content).digest('hex'));
 assert.throws(()=>fragments(1,'user','bad\ud800'),/Unicode/);
});
