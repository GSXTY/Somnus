const test=require('node:test');
const assert=require('node:assert/strict');
const {isScopeInvalid}=require('./workspace-scope.cjs');
test('only definitive scope errors revoke workspace processes',()=>{
 for(const error of [{scopeInvalid:true},{code:'ENOENT'},{code:'EACCES'}]) assert.equal(isScopeInvalid(error),true);
 for(const error of [{statusCode:503},{code:'ECONNREFUSED'},{name:'TimeoutError'},new Error('temporary')])assert.equal(isScopeInvalid(error),false);
});
