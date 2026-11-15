"""Same-origin BaseHTTPRequestHandler adapter; owns matching responses."""
import json
from urllib.parse import urlsplit
from .service import AUTO_TITLE, AssistantError


def handle_http(handler, service):
    path = urlsplit(handler.path).path
    if not path.startswith('/api/assistant/'):
        return False
    stream = None
    turn = None
    started = False
    try:
        if service is None:
            raise AssistantError('service_unavailable', '会话服务尚未初始化。', 503)
        parts = path[len('/api/assistant/'):].strip('/').split('/')
        method = handler.command
        if method == 'GET':
            if parts == ['status']:
                handler.send(service.status())
            elif parts == ['conversations']:
                handler.send(dict(conversations=service.conversations()))
            elif len(parts) == 2 and parts[0] == 'conversations':
                handler.send(service.get(parts[1]))
            else:
                raise AssistantError('not_found', '接口不存在。', 404)
            return True
        if method != 'POST':
            raise AssistantError('method_not_allowed', '不支持此请求方法。', 405)
        try:
            length = int(handler.headers.get('Content-Length', '0'))
        except ValueError:
            raise AssistantError('invalid_request', '请求长度无效。')
        if length < 0 or length > 15 * 1024 * 1024:
            raise AssistantError('request_too_large', '请求过大。', 413)
        try:
            body = json.loads(handler.rfile.read(length)) if length else {}
        except (ValueError, UnicodeDecodeError):
            raise AssistantError('invalid_json', '请求内容必须是有效JSON。')
        if not isinstance(body, dict):
            raise AssistantError('invalid_request', '请求内容必须是对象。')
        if parts == ['conversations']:
            handler.send(dict(conversation=service.create(body.get('title', AUTO_TITLE))), 201)
        elif len(parts) == 3 and parts[0] == 'conversations':
            cid, action = parts[1:]
            if action == 'rename':
                handler.send(dict(conversation=service.rename(cid, body.get('title'))))
            elif action == 'delete':
                handler.send(service.delete(cid))
            elif action == 'cancel':
                handler.send(dict(cancelled=service.cancel(cid)))
            elif action == 'messages':
                user, assistant, cancel = service.begin(cid, body.get('content', ''), body.get('attachments'))
                turn = cid, assistant, cancel
                stream = service.stream(cid, user, assistant, cancel)
                handler.send_response(200)
                handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
                handler.send_header('Cache-Control', 'no-cache, no-store')
                handler.send_header('X-Accel-Buffering', 'no')
                handler.send_header('Connection', 'close')
                handler.end_headers()
                started = True
                handler.close_connection = True
                for event, data in stream:
                    handler.wfile.write(('event: ' + event + '\ndata: ' + json.dumps(data, ensure_ascii=False) + '\n\n').encode())
                    handler.wfile.flush()
            else:
                raise AssistantError('not_found', '接口不存在。', 404)
        else:
            raise AssistantError('not_found', '接口不存在。', 404)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
        if turn:
            turn[2].set()
    except AssistantError as exc:
        if not started:
            handler.send(dict(error=dict(code=exc.code, message=exc.message)), exc.status)
    except Exception:
        if not started:
            handler.send(dict(error=dict(code='internal_error', message='会话服务暂不可用，请稍后重试。')), 500)
    finally:
        try:
            if stream:
                stream.close()
        except Exception:
            pass
        finally:
            if turn:
                cid, assistant, cancel = turn
                try:
                    if assistant['status'] == 'streaming':
                        assistant['status'] = 'cancelled'
                        service.save(cid, assistant)
                except Exception:
                    pass
                finally:
                    service.release(cid, cancel)
    return True
