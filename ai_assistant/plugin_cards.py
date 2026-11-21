"""Bounded declarative plugin documents. No HTML, JavaScript or executable actions."""
import json
import math
import re

PLUGIN=re.compile(r'(?:@[a-z0-9_.-]+/)?[A-Za-z0-9_.-]{1,160}')
KEY=re.compile(r'[A-Za-z][A-Za-z0-9_-]{0,63}')


def text(value,limit=2000):
    if not isinstance(value,str) or len(value.encode("utf-16-le",errors="surrogatepass"))//2>limit or any(0xd800<=ord(c)<=0xdfff or ord(c)<32 and c not in '\t\n\r' or ord(c)==127 for c in value):
        raise ValueError('Invalid document text')
    return value


def obj(value,allowed,required=()):
    if not isinstance(value,dict) or set(value)-set(allowed) or not set(required)<=set(value):raise ValueError('Invalid document fields')


def key(value):
    if not isinstance(value,str) or not KEY.fullmatch(value) or value in ('__proto__','constructor','prototype'):raise ValueError('Invalid document key')
    return value


def number(value):
    if type(value) not in (int,float) or not math.isfinite(value):raise ValueError('Invalid document number')
    return value


def document(value,plugin_id=None):
    obj(value,{'version','title','blocks','actions'},{'version','blocks'})
    if type(value['version']) is not int or value['version']!=1 or len(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(",",":")).encode('utf-8'))>32768:raise ValueError('Invalid document version or size')
    blocks=value['blocks'];actions=value.get('actions',[])
    if not isinstance(blocks,list) or len(blocks)>20 or not isinstance(actions,list) or len(actions)>8:raise ValueError('Invalid document item count')
    result={'version':1,'blocks':[]}
    if 'title' in value:result['title']=text(value['title'],160)
    form_targets=[]
    for block in blocks:
        if not isinstance(block,dict):raise ValueError('Invalid document block')
        kind=block.get('type')
        if kind=='text':
            obj(block,{'type','text'},{'text'});clean=dict(type=kind,text=text(block['text'],8000))
        elif kind=='list':
            obj(block,{'type','items'},{'items'})
            if not isinstance(block['items'],list) or len(block['items'])>50:raise ValueError('Invalid list')
            clean=dict(type=kind,items=[text(item,2000) for item in block['items']])
        elif kind=='metrics':
            obj(block,{'type','items'},{'items'})
            if not isinstance(block['items'],list) or len(block['items'])>16:raise ValueError('Invalid metrics')
            items=[]
            for item in block['items']:
                obj(item,{'label','value'},{'label','value'});items.append(dict(label=text(item['label'],100),value=text(item['value'],200)))
            clean=dict(type=kind,items=items)
        elif kind=='table':
            obj(block,{'type','columns','rows'},{'columns','rows'})
            columns=block['columns'];rows=block['rows']
            if not isinstance(columns,list) or not 1<=len(columns)<=8 or not isinstance(rows,list) or len(rows)>50:raise ValueError('Invalid table')
            cols=[]
            for col in columns:
                obj(col,{'key','label'},{'key','label'});cols.append(dict(key=key(col['key']),label=text(col['label'],100)))
            keys={col['key'] for col in cols}
            if len(keys)!=len(cols):raise ValueError('Duplicate table key')
            cleanrows=[]
            for row in rows:
                if not isinstance(row,dict) or set(row)!=keys:raise ValueError('Invalid table row')
                cleanrows.append({name:text(row[name],2000) for name in keys})
            clean=dict(type=kind,columns=cols,rows=cleanrows)
        elif kind=='chart':
            obj(block,{'type','chartType','labels','series'},{'chartType','labels','series'})
            labels=block['labels'];series=block['series']
            if block['chartType'] not in ('bar','line') or not isinstance(labels,list) or len(labels)>24 or not isinstance(series,list) or not 1<=len(series)<=4:raise ValueError('Invalid chart')
            parsed=[]
            for item in series:
                obj(item,{'label','values'},{'label','values'})
                if not isinstance(item['values'],list) or len(item['values'])!=len(labels):raise ValueError('Chart lengths differ')
                parsed.append(dict(label=text(item['label'],100),values=[number(item) for item in item['values']]))
            clean=dict(type=kind,chartType=block['chartType'],labels=[text(item,100) for item in labels],series=parsed)
        elif kind=='status':
            obj(block,{'type','label','state','detail'},{'label','state'})
            if block['state'] not in ('idle','running','success','error'):raise ValueError('Invalid status')
            clean=dict(type=kind,label=text(block['label'],100),state=block['state'])
            if 'detail' in block:clean['detail']=text(block['detail'],2000)
        elif kind=='form':
            obj(block,{'type','fields','submitActionId'},{'fields','submitActionId'})
            fields=block['fields']
            if not isinstance(fields,list) or not 1<=len(fields)<=12:raise ValueError('Invalid form')
            parsed=[];seen=set()
            for field in fields:
                obj(field,{'key','label','kind','value','options'},{'key','label','kind'})
                name=key(field['key']);ftype=field['kind']
                if name in seen or ftype not in ('string','number','boolean','enum'):raise ValueError('Invalid form field')
                seen.add(name);item=dict(key=name,label=text(field['label'],100),kind=ftype)
                if ftype=='enum':
                    options=field.get('options')
                    if not isinstance(options,list) or not 1<=len(options)<=30 or len(set(options))!=len(options):raise ValueError('Invalid enum options')
                    item['options']=[text(option,100) for option in options]
                elif 'options' in field:raise ValueError('Options require enum')
                if 'value' in field:
                    v=field['value']
                    if ftype=='number':number(v)
                    elif ftype=='boolean' and type(v) is not bool:raise ValueError('Invalid boolean')
                    elif ftype in ('string','enum'):text(v,2000)
                    if ftype=='enum' and v not in item['options']:raise ValueError('Enum value absent')
                    item['value']=v
                parsed.append(item)
            target=key(block['submitActionId']);form_targets.append(target);clean=dict(type=kind,fields=parsed,submitActionId=target)
        else:raise ValueError('Unsupported document block')
        result['blocks'].append(clean)
    parsed=[];ids={}
    for action in actions:
        if not isinstance(action,dict):raise ValueError('Invalid action')
        kind=action.get('type');label=text(action.get('label'),80)
        common={'type','label','id'}
        if kind=='insertDraft':obj(action,common|{'text'},{'text'});clean=dict(type=kind,label=label,text=text(action['text'],8000))
        elif kind=='open-own-page':
            obj(action,common|{'pageId'},{'pageId'});page=text(action['pageId'],250)
            if '#' not in page or plugin_id is not None and not page.startswith(plugin_id+'#'):raise ValueError('Cross-plugin page')
            clean=dict(type=kind,label=label,pageId=page)
        elif kind=='read-own-settings':obj(action,common);clean=dict(type=kind,label=label)
        elif kind=='save-own-settings':
            obj(action,common|{'sectionId','revision'},{'id','sectionId','revision'})
            revision=action['revision']
            if type(revision) is not int or not 0<=revision<=2**53-1:raise ValueError('Invalid settings revision')
            clean=dict(type=kind,label=label,sectionId=text(action['sectionId'],160),revision=revision)
        else:raise ValueError('Unsupported action')
        if 'id' in action:
            ident=key(action['id'])
            if ident in ids:raise ValueError('Duplicate action ID')
            ids[ident]=kind;clean['id']=ident
        parsed.append(clean)
    if any(ids.get(target) not in ('save-own-settings','insertDraft') for target in form_targets):raise ValueError('Form action is missing or unsupported')
    if parsed:result['actions']=parsed
    return result


def cards(value):
    if value is None: return []
    if not isinstance(value,list) or len(value)>16 or len(json.dumps(value,ensure_ascii=False,separators=(",",":"),allow_nan=False).encode())>128*1024:
        raise ValueError('Too many plugin cards')
    result=[]
    for item in value:
        if not isinstance(item,dict) or set(item)!={'pluginId','document'} or not isinstance(item['pluginId'],str) or not PLUGIN.fullmatch(item['pluginId']):
            raise ValueError('Invalid card plugin identity')
        result.append(dict(pluginId=item['pluginId'],document=document(item['document'],item['pluginId'])))
    return result


def tool_owners(db, plugin_ids, registry):
    if not registry or not hasattr(registry,'tool_server_ids'): return {}
    owners={}
    for plugin_id in plugin_ids:
        row=db.execute('SELECT mcp_ids FROM personal_plugins WHERE id=? AND enabled=1',(plugin_id,)).fetchone()
        if row is None: row=db.execute('SELECT mcp_ids FROM default_plugins WHERE id=? AND enabled=1',(plugin_id,)).fetchone()
        if row:
            for server in json.loads(row['mcp_ids']): owners.setdefault(server,set()).add(plugin_id)
    return {name:next(iter(owners[server])) for name,server in registry.tool_server_ids().items() if len(owners.get(server,set()))==1}
