"""Loopback-only synthetic OpenAI fixture. No real model, network, key or tools."""
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = 'synthetic-only'
MEMORY = re.compile(r'SOMNUS_MEMORY_[A-Za-z0-9_-]{1,80}')


def message_text(value):
    if isinstance(value,str): return value
    if isinstance(value,list): return '\n'.join(message_text(item) for item in value)
    if isinstance(value,dict):
        return '\n'.join(message_text(value[key]) for key in ('content','text','input_text','output_text') if key in value)
    return ''


class SyntheticModel(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self):
        super().__init__(('127.0.0.1',0), Handler)
        self.requests=[]


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def reply(self,value,status=200):
        data=json.dumps(value).encode()
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
    def do_GET(self):
        if self.path=='/health': return self.reply({'ok':True,'synthetic':True})
        if self.path=='/requests': return self.reply({'requests':self.server.requests})
        if self.path=='/v1/models': return self.reply({'object':'list','data':[{'id':'synthetic','object':'model','owned_by':'local-fixture'}]})
        return self.reply({'error':'not found'},404)
    def do_POST(self):
        if self.headers.get('Authorization') != 'Bearer '+KEY:
            return self.reply({'error':{'message':'Synthetic fixture credential required'}},401)
        length=int(self.headers.get('Content-Length','0'))
        if not 0<=length<=4*1024*1024: return self.reply({'error':'too large'},413)
        try: body=json.loads(self.rfile.read(length))
        except (ValueError,UnicodeError): return self.reply({'error':'invalid JSON'},400)
        if self.path not in ('/v1/chat/completions','/chat/completions','/v1/responses','/responses'):
            return self.reply({'error':'not found'},404)
        messages=body.get('messages',body.get('input',[]))
        markers=sorted(set(MEMORY.findall(message_text(messages))))
        output='SYNTHETIC-CONTINUE' + (' INHERITED_CONTEXT '+','.join(markers) if markers else ' MEMORY_MISSING')
        self.server.requests.append({'path':self.path,'model':body.get('model'),'markers':markers,'message_count':len(messages) if isinstance(messages,list) else 1,'document_marker':'SYNTHETIC-DOCUMENT-CONTINUATION-MARKER' in message_text(messages),'skill_marker':'SYNTHETIC-SKILL-CONTINUATION-MARKER' in message_text(messages),'somnus_identity':'You are Somnus, the assistant in the Somnus desktop app.' in message_text(messages)})
        self.server.requests[:]=self.server.requests[-100:]
        created=int(time.time());ident='chatcmpl-synthetic-'+str(len(self.server.requests))
        usage={'prompt_tokens':8,'completion_tokens':8,'total_tokens':16}
        if 'responses' in self.path:
            response={'id':'resp-synthetic','object':'response','created_at':created,'status':'completed','model':body.get('model','synthetic'),
                      'output':[{'id':'msg-synthetic','type':'message','role':'assistant','status':'completed','content':[{'type':'output_text','text':output,'annotations':[]}]}],
                      'usage':{'input_tokens':8,'output_tokens':8,'total_tokens':16}}
            if not body.get('stream'): return self.reply(response)
            events=[('response.created',{'response':dict(response,status='in_progress',output=[])}),
                    ('response.output_item.added',{'output_index':0,'item':dict(response['output'][0],status='in_progress',content=[])}),
                    ('response.content_part.added',{'item_id':'msg-synthetic','output_index':0,'content_index':0,'part':{'type':'output_text','text':'','annotations':[]}}),
                    ('response.output_text.delta',{'item_id':'msg-synthetic','output_index':0,'content_index':0,'delta':output}),
                    ('response.output_text.done',{'item_id':'msg-synthetic','output_index':0,'content_index':0,'text':output}),
                    ('response.output_item.done',{'output_index':0,'item':response['output'][0]}),('response.completed',{'response':response})]
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
            for index,(kind,payload) in enumerate(events):
                self.wfile.write(('event: '+kind+'\ndata: '+json.dumps(dict(payload,type=kind,sequence_number=index))+'\n\n').encode())
            self.wfile.flush();return
        if not body.get('stream'):
            return self.reply({'id':ident,'object':'chat.completion','created':created,'model':body.get('model','synthetic'),'choices':[{'index':0,'message':{'role':'assistant','content':output},'finish_reason':'stop'}],'usage':usage})
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Connection','close');self.end_headers()
        base={'id':ident,'object':'chat.completion.chunk','created':created,'model':body.get('model','synthetic')}
        for delta,finish in (({'role':'assistant'},None),({'content':output},None),({},'stop')):
            chunk=dict(base,choices=[{'index':0,'delta':delta,'finish_reason':finish}])
            if finish:chunk['usage']=usage
            self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
        self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()


if __name__=='__main__':
    server=SyntheticModel()
    print(json.dumps({'origin':'http://127.0.0.1:'+str(server.server_address[1]),'key':KEY,'model':'synthetic'}),flush=True)
    server.serve_forever()
