// Pure browser mirror of host declarative schema; contract parity is regression-tested.
const TEXT = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function object(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
        throw Error('插件界面声明无效。');
}
function text(value, max = 2000) {
    if (typeof value !== 'string' || value.length > max || TEXT.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
        throw Error('插件界面文本无效。');
    return value;
}
function key(value) {
    if(typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)||['__proto__','constructor','prototype'].includes(value))throw Error('插件界面键无效。');
    return value;
}
function array(value,max) { if(!Array.isArray(value)||value.length>max)throw Error('插件界面列表无效。');return value; }
function unique(values) { if(new Set(values).size!==values.length)throw Error('插件界面键重复。'); }
function scalar(value) { if(typeof value==='string')return text(value,2000);if(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;throw Error('插件表单值无效。'); }
function extendedBlock(block) {
    if(block.type==='table') {
        object(block,['type','columns','rows']);
        const columns=array(block.columns,8).map(column=>{object(column,['key','label']);return{key:key(column.key),label:text(column.label,100)};});
        if(!columns.length)throw Error('表格需要列。');unique(columns.map(column=>column.key));
        return {type:'table',columns,rows:array(block.rows,50).map(row=>{object(row,columns.map(column=>column.key));return Object.fromEntries(columns.map(column=>[column.key,text(row[column.key],2000)]));})};
    }
    if(block.type==='chart') {
        object(block,['type','chartType','labels','series']);
        if(!['bar','line'].includes(block.chartType))throw Error('图表类型无效。');
        const labels=array(block.labels,24).map(label=>text(label,100));
        return {type:'chart',chartType:block.chartType,labels,series:array(block.series,4).map(series=>{object(series,['label','values']);const values=array(series.values,24);if(values.length!==labels.length||values.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw Error('图表数值无效。');return{label:text(series.label,100),values:[...values]};})};
    }
    if(block.type==='status') {
        object(block,['type','label','state','detail']);
        if(!['idle','running','success','error'].includes(block.state))throw Error('工具状态无效。');
        return {type:'status',label:text(block.label,100),state:block.state,...(block.detail===undefined?{}:{detail:text(block.detail,2000)})};
    }
    if(block.type==='form') {
        object(block,['type','fields','submitActionId']);
        const fields=array(block.fields,12).map(field=>{
            object(field,['key','label','kind','value','options']);
            if(!['string','number','boolean','enum'].includes(field.kind))throw Error('表单字段类型无效。');
            const options=field.kind==='enum'?array(field.options,30).map(option=>text(option,100)):undefined;
            if(field.kind!=='enum'&&field.options!==undefined)throw Error('非枚举字段不能声明选项。');
            if(field.value!==undefined){scalar(field.value);if(field.kind==='enum'?!options.includes(field.value):typeof field.value!==field.kind)throw Error('表单字段值不匹配。');}
            return {key:key(field.key),label:text(field.label,100),kind:field.kind,...(options?{options}:{}),...(field.value===undefined?{}:{value:field.value})};
        });
        unique(fields.map(field=>field.key));return{type:'form',fields,submitActionId:key(block.submitActionId)};
    }
    return null;
}
function document(value) {
    if (new TextEncoder().encode(JSON.stringify(value) || '').length > 32768)
        throw Error('插件界面过大。');
    object(value, ['version', 'title', 'blocks', 'actions']);
    if (value.version !== 1 || !Array.isArray(value.blocks) || value.blocks.length > 20)
        throw Error('插件界面版本或内容无效。');
    const blocks = value.blocks.map(block => {
        object(block,Object.keys(block||{}));
        const extended=extendedBlock(block);if(extended)return extended;
        if (block.type === 'text') {
            object(block, ['type', 'text']);
            return {
                type: 'text', text: text(block.text, 8000)
            };
        }
        if (block.type === 'list') {
            object(block, ['type', 'items']);
            if (!Array.isArray(block.items) || block.items.length > 50)
                throw Error('插件列表无效。');
            return {
                type: 'list', items: block.items.map(item => text(item))
            };
        }
        if (block.type === 'metrics') {
            object(block, ['type', 'items']);
            if (!Array.isArray(block.items) || block.items.length > 16)
                throw Error('插件指标无效。');
            return {
                type: 'metrics', items: block.items.map(item => {
                    object(item, ['label', 'value']);
                    return {
                        label: text(item.label, 100), value: text(item.value, 200)
                    };
                })
            };
        }
        throw Error('此插件界面类型尚未适配。');
    });
    const actions = value.actions ?? [];
    if (!Array.isArray(actions) || actions.length > 8)
        throw Error('插件操作无效。');
    const clean = {
        version: 1, ...(value.title !== undefined ? {
            title: text(value.title, 160)
        } : {}), blocks, actions: actions.map(action => {
            object(action,Object.keys(action||{}));
            const id=action.id===undefined?{}:{id:key(action.id)};
            if(action.type==='save-own-settings'){object(action,['type','id','label','sectionId','revision']);if(!Number.isSafeInteger(action.revision)||action.revision<0)throw Error('设置版本无效。');return{type:action.type,id:key(action.id),label:text(action.label,80),sectionId:text(action.sectionId,200),revision:action.revision};}
            if (action.type === 'insertDraft') {
                object(action, ['type', 'id', 'label', 'text']);
                return {
                    ...id, type: action.type, label: text(action.label, 80), text: text(action.text, 8000)
                };
            }
            if (action.type === 'open-own-page') {
                object(action, ['type', 'id', 'label', 'pageId']);
                return {
                    ...id, type: action.type, label: text(action.label, 80), pageId: text(action.pageId, 250)
                };
            }
            if (action.type === 'read-own-settings') {
                object(action, ['type', 'id', 'label']);
                return {
                    ...id, type: action.type, label: text(action.label, 80)
                };
            }
            throw Error('插件操作尚未适配。');
        })
    };
    unique(clean.actions.filter(action=>action.id).map(action=>action.id));
    for(const block of blocks.filter(block=>block.type==='form')) {
        const action=clean.actions.find(action=>action.id===block.submitActionId);
        if(!action||!['save-own-settings','insertDraft'].includes(action.type))throw Error('表单未绑定受支持操作。');
    }
    return clean;
}

export function safePluginDocument(value,pluginId){try{const clean=document(value);if(pluginId&&clean.actions.some(action=>action.type==='open-own-page'&&action.pageId.includes('#')&&!action.pageId.startsWith(pluginId+'#')))return null;return value;}catch{return null;}}
