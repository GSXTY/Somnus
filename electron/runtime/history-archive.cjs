const MAX_PAGE=64*1024;
// Fragment at Unicode scalar boundaries; JSON escaping is included in the page budget.
function fragments(seq,role,content) {
  const rows=[];let points=[],bytes=0;
  for(const point of content) {
    if(/[\uD800-\uDFFF]/u.test(point))throw Error('历史文本包含无效Unicode。');
    const size=Buffer.byteLength(JSON.stringify(point))-2;
    if(bytes+size>23000){rows.push({seq,role,part:rows.length,content:points.join(''),final:false});points=[];bytes=0;}
    points.push(point);bytes+=size;
  }
  rows.push({seq,role,part:rows.length,content:points.join(''),final:true});return rows;
}
async function archiveChildHistory({call,range,sessionId,atSeq,reservationId,client,validate,redact}) {
  let beforeSeq,pageIndex=0,pending=[],totalBytes=0,fragmentsCount=0;
  async function upload(done){validate();await client.archiveNativeForkPage(reservationId,{source_session_id:sessionId,page_index:pageIndex++,records:pending,done});pending=[];}
  for(let pageCount=0;pageCount<100000;pageCount++) {
    validate();
    const history=await call('events',{address:{kind:'subagent',parentSessionId:range.parentId,childSessionId:sessionId,mode:range.mode},throughSeq:atSeq,maxMessages:100,...(beforeSeq===undefined?{}:{beforeSeq})});
    const records=history.records||[];
    for(const record of records) {
      const event=record.event;
      if(!event||event.seq<=range.after||event.seq>atSeq||!['user/message','assistant/message'].includes(event.type))continue;
      const message=event.type==='user/message'?event.data:event.data?.message;
      const raw=(message?.content||[]).filter(part=>part.type==='text').map(part=>part.text).join('\n');
      if(Buffer.byteLength(raw)>64*1024*1024)throw Error('单条历史超过64MiB归档安全上限。');
      const text=redact(raw);
      for(const fragment of fragments(event.seq,event.type.split('/')[0],text)) {
        totalBytes+=Buffer.byteLength(fragment.content);fragmentsCount++;
        if(totalBytes>64*1024*1024||fragmentsCount>100000)throw Error('历史超过本机分页归档安全上限。');
        if(pending.length>=100||Buffer.byteLength(JSON.stringify({source_session_id:sessionId,page_index:pageIndex,records:[...pending,fragment],done:false}))>MAX_PAGE)await upload(false);
        pending.push(fragment);
      }
    }
    const first=records[0]?.event?.seq;
    if(!history.hasMore||!Number.isSafeInteger(first)||first<=range.after+1){await upload(true);return;}
    if(first===beforeSeq)throw Error('原生历史游标未推进，分支未提交。');
    beforeSeq=first;
  }
  throw Error('原生历史分页超过安全范围，分支未提交。');
}
module.exports={archiveChildHistory,fragments};
