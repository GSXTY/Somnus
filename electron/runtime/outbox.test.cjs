const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {ResultOutbox}=require('./result-outbox.cjs');
test('outbox survives host recreation encrypted, never writes plaintext fallback, and removes acknowledged results',async()=>{
 const home=await fs.mkdtemp(path.join(os.tmpdir(),'somnus-outbox-'));try{
 const key=crypto.randomBytes(32),storage={isEncryptionAvailable:()=>true,encryptString:text=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv),body=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]);},decryptString:bytes=>{const decipher=crypto.createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}};
 const route={conversationId:'a'.repeat(32),taskId:'b'.repeat(32),agentId:'agent',runtime:'acp'},body={owner_id:'owner',agent_id:'agent',finish_receipt:'f'.repeat(64),content:'SYNTHETIC PRIVATE RESULT',status:'complete'};
 const first=new ResultOutbox(home,storage);await first.save(route,body);const files=await fs.readdir(path.join(home,'runtime-results'));assert.equal(files.length,1);assert(!(await fs.readFile(path.join(home,'runtime-results',files[0]))).includes(Buffer.from(body.content)));
 const second=new ResultOutbox(home,storage),rows=await second.list();assert.equal(rows.length,1);assert.equal(rows[0].body.content,body.content);await second.remove(rows[0].key);assert.equal((await second.list()).length,0);
 const memory=new ResultOutbox(home,{isEncryptionAvailable:()=>false});await memory.save(route,body);assert.equal((await fs.readdir(path.join(home,'runtime-results'))).length,0);assert.equal((await memory.list()).length,1);
 }finally{await fs.rm(home,{recursive:true,force:true});}
});
