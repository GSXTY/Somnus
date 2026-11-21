const CAPABILITIES = new Set(['tools','skills','mcp','owned-pages','settings-extensions','message-extensions','sidebar-extensions']);
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function compare(left,right){
 const a=VERSION.exec(left),b=VERSION.exec(right);
 for(let i=1;i<=3;i++){const x=BigInt(a[i]),y=BigInt(b[i]);if(x!==y)return x>y?1:-1;}
 if(!a[4]||!b[4])return a[4]===b[4]?0:a[4]?-1:1;
 const x=a[4].split('.'),y=b[4].split('.');
 for(let i=0;i<Math.max(x.length,y.length);i++){
  if(x[i]===y[i])continue;if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;
  const xn=/^\d+$/.test(x[i]),yn=/^\d+$/.test(y[i]);
  if(xn&&yn)return BigInt(x[i])>BigInt(y[i])?1:-1;if(xn!==yn)return xn?-1:1;return x[i]>y[i]?1:-1;
 }return 0;
}
function pluginContract(metadata, appVersion) {
  const declaration = metadata?.dsh?.somnus?.contract;
  if (declaration !== undefined && (!declaration || typeof declaration !== 'object' || Array.isArray(declaration))) throw Error('插件兼容声明无效。');
  if (declaration && (declaration.schema_version !== 1 || Object.keys(declaration).some(key => !['schema_version','minimum_somnus_version','capabilities'].includes(key)))) throw Error('插件兼容声明版本或字段不受支持。');
  const minimum = declaration?.minimum_somnus_version ?? null;
  if (minimum !== null && (typeof minimum !== 'string' || !VERSION.test(minimum))) throw Error('插件最低 Somnus 版本无效。');
  const capabilities = declaration?.capabilities ?? [];
  if (!Array.isArray(capabilities) || capabilities.length > CAPABILITIES.size || capabilities.some(value => !CAPABILITIES.has(value)) || new Set(capabilities).size !== capabilities.length) throw Error('插件能力声明无效。');
  if (minimum && appVersion && VERSION.test(appVersion) && compare(minimum,appVersion)>0) throw Error('此插件需要更新版本的 Somnus。');
  const requiresAdapter=Boolean(metadata?.dsh?.client || capabilities.some(value=>['message-extensions','sidebar-extensions'].includes(value)));
  return {schema_version:1,format:'dsh.bundle',legacy:!declaration,capabilities:[...capabilities],minimum_somnus_version:minimum,compatibility:requiresAdapter?'requires-adapter':declaration && (!minimum || VERSION.test(appVersion || ''))?'compatible':'unverified'};
}
function pluginContractView(metadata,appVersion){try{return pluginContract(metadata,appVersion);}catch{return {schema_version:1,format:'dsh.bundle',legacy:false,capabilities:[],minimum_somnus_version:null,compatibility:'incompatible',reason:'插件兼容声明无效或需要更新版本的 Somnus。'};}}
module.exports={pluginContract,pluginContractView};
