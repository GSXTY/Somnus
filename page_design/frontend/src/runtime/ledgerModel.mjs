export function eventTime(value) {
  if(typeof value==='number'&&Number.isFinite(value))return value>1e12?value:value*1000;
  if(typeof value==='string'){const result=Date.parse(value);return Number.isFinite(result)?result:null;}
  return null;
}
export function filterLedger(records,{query='',type,start='',end=''}){
 const term=query.trim().toLowerCase(),from=start?Date.parse(start):null,to=end?Date.parse(end):null;
 return records.filter(record=>{
   const at=eventTime(record.at);
   return (!type||record.type===type)&&(!Number.isFinite(from)||at!==null&&at>=from)&&(!Number.isFinite(to)||at!==null&&at<=to)&&
     (!term||[record.type,record.role,record.text,record.tool?.name].some(value=>typeof value==='string'&&value.toLowerCase().includes(term)));
 });
}
