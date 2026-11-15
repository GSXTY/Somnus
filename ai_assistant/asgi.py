"""Native ASGI conversation routes; synchronous model work stays in worker threads."""
import json
import os
from urllib.parse import unquote
import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from deep_analysis.service import AnalysisError
from . import company_runtime, delegation
from .external_context import TABLE_OWNER, TABLE_UPLOAD_LIMIT
from .models import ModelError
from .project_access import DesktopAccess
from .project_files import ProjectFileError
from .plugin_bundles import BundleError, MAX_MANIFEST_BYTES
from .service import AUTO_TITLE, AssistantError
from .skill_library import MAX_UPLOAD as SKILL_UPLOAD_LIMIT, SkillError

LIMIT = 15 * 1024 * 1024

def create_router():
    router = APIRouter(prefix='/api/assistant', tags=['assistant'])
    desktop = DesktopAccess()
    default_plugin_owner = os.getenv('VV_MAN_PLUGIN_DEFAULTS_OWNER', '').strip() == '1'

    async def service_for(request):
        provider = getattr(request.app.state, 'assistant_service_for_request', None)
        service = await anyio.to_thread.run_sync(provider, request) if provider else getattr(request.app.state, 'assistant_service', None)
        if service is None:
            raise AssistantError('service_unavailable', '会话服务尚未初始化。', 503)
        return service

    async def body_for(request, limit=LIMIT):
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > limit:
                raise AssistantError('request_too_large', '请求过大。', 413)
        try:
            body = json.loads(raw) if raw else {}
        except (ValueError, UnicodeDecodeError):
            raise AssistantError('invalid_json', '请求内容必须是有效JSON。')
        if not isinstance(body, dict):
            raise AssistantError('invalid_request', '请求内容必须是对象。')
        return body

    def failure(exc):
        return JSONResponse({'error': {'code': exc.code, 'message': str(exc)}}, status_code=exc.status)

    def require_personal_skills(request):
        if not desktop.allowed(request):
            raise AssistantError('desktop_required', '个人技能仅可从本机 Windows 桌面访问。', 403)

    async def plugin_access(request):
        if not desktop.allowed(request):
            raise AssistantError('desktop_required', '插件仅可从本机 Windows 桌面管理和选择。', 403)
        return await service_for(request), getattr(request.app.state, 'mcp_registry', None)

    async def default_plugin_management(request):
        service, registry = await plugin_access(request)
        if not default_plugin_owner:
            raise AssistantError('plugin_owner_required', '只有此桌面配置的所有者可以管理默认插件。', 403)
        return service, registry

    @router.get('/plugins')
    async def list_plugins(request: Request):
        try:
            service, registry = await plugin_access(request)
            plugins = await anyio.to_thread.run_sync(service.plugins.list, registry)
            return JSONResponse({'plugins': plugins}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.get('/plugins/defaults')
    async def list_default_plugins(request: Request):
        try:
            service, registry = await plugin_access(request)
            plugins = await anyio.to_thread.run_sync(service.plugins.defaults, registry)
            return JSONResponse({'plugins': plugins, 'owner_configured': default_plugin_owner},
                                headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.post('/plugins/defaults')
    async def publish_default_plugin(request: Request):
        try:
            service, registry = await default_plugin_management(request)
            body = await body_for(request, MAX_MANIFEST_BYTES)
            if set(body) != {'plugin_id'}:
                raise BundleError('invalid_plugin', '请选择已安装的个人插件发布。')
            plugin = await anyio.to_thread.run_sync(service.plugins.publish_default, body['plugin_id'], registry)
            return JSONResponse({'plugin': plugin}, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.delete('/plugins/defaults/{plugin_id}')
    async def remove_default_plugin(plugin_id: str, request: Request):
        try:
            service, _ = await default_plugin_management(request)
            result = await anyio.to_thread.run_sync(service.plugins.remove_default, plugin_id)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.post('/plugins/import')
    async def import_plugin(request: Request):
        try:
            service, registry = await plugin_access(request)
            fields = await body_for(request, MAX_MANIFEST_BYTES)
            plugin = await anyio.to_thread.run_sync(service.plugins.add, fields, registry)
            return JSONResponse({'plugin': plugin}, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.patch('/plugins/{plugin_id}')
    async def enable_plugin(plugin_id: str, request: Request):
        try:
            service, registry = await plugin_access(request)
            body = await body_for(request, MAX_MANIFEST_BYTES)
            if set(body) != {'enabled'}:
                raise BundleError('invalid_plugin', '请指定插件启用状态。')
            plugin = await anyio.to_thread.run_sync(service.plugins.set_enabled, plugin_id, body['enabled'], registry)
            return JSONResponse({'plugin': plugin}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.delete('/plugins/{plugin_id}')
    async def remove_plugin(plugin_id: str, request: Request):
        try:
            service, _ = await plugin_access(request)
            result = await anyio.to_thread.run_sync(service.plugins.remove, plugin_id)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.get('/skills')
    async def list_skills(request: Request):
        try:
            require_personal_skills(request)
            service = await service_for(request)
            skills = await anyio.to_thread.run_sync(service.skills.list)
            return JSONResponse({'skills': skills}, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/skills/import')
    async def import_skill(request: Request):
        try:
            require_personal_skills(request)
            service = await service_for(request)
            filename = unquote(request.headers.get('X-Filename', ''))
            raw = bytearray()
            async for chunk in request.stream():
                if len(raw) + len(chunk) > SKILL_UPLOAD_LIMIT:
                    raise SkillError('skill_file_too_large', '技能文件不能超过 2 MiB。', 413)
                raw.extend(chunk)
            imported = await anyio.to_thread.run_sync(service.skills.add, filename, bytes(raw))
            return JSONResponse({'skill': imported}, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, SkillError) as exc:
            return failure(exc)

    @router.patch('/skills/{skill_id}')
    async def update_skill(skill_id: str, request: Request):
        try:
            require_personal_skills(request)
            service, body = await service_for(request), await body_for(request)
            skill = await anyio.to_thread.run_sync(service.skills.set_enabled, skill_id, body.get('enabled'))
            return JSONResponse({'skill': skill}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, SkillError) as exc:
            return failure(exc)

    @router.delete('/skills/{skill_id}')
    async def delete_skill(skill_id: str, request: Request):
        try:
            require_personal_skills(request)
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(service.skills.remove, skill_id)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, SkillError) as exc:
            return failure(exc)

    def require_desktop(request, *, native=False):
        if not desktop.allowed(request, native=native):
            raise AssistantError('desktop_required', '项目目录和修改确认仅可从本机桌面访问。', 403)

    def workspace_fields(request, body, *, creating=False):
        fields = body.copy()
        grant = fields.pop('folder_grant', None)
        if 'root_path' in fields:
            if 'source_folders' in fields:
                raise AssistantError('invalid_sources', '请使用单一来源配置格式。')
            root = fields.pop('root_path')
            fields['source_folders'] = [] if root is None or root == '' else [dict(root_path=root, folder_grant=grant)]
        if 'source_folders' in fields:
            if not isinstance(fields['source_folders'], list):
                raise AssistantError('invalid_sources', '来源文件夹必须为列表。')
            if fields['source_folders'] or not creating:
                require_desktop(request)
        return fields

    @router.post('/project-folder-grants')
    async def project_folder_grant(request: Request):
        try:
            require_desktop(request, native=True)
            body = await body_for(request)
            result = await anyio.to_thread.run_sync(desktop.grant, body.get('path'))
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ProjectFileError) as exc:
            return failure(exc)

    @router.get('/status')
    async def status(request: Request):
        try:
            service = await service_for(request)
            model_id = request.query_params.get('model_id')
            result = await anyio.to_thread.run_sync(service.status, desktop.allowed(request), model_id)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/files')
    async def upload(request: Request):
        try:
            service = await service_for(request)
            name = unquote(request.headers.get('X-Filename', ''))
            content = await request.body()
            if len(content) > 10 * 1024 * 1024:
                raise AssistantError('file_too_large', '文件超过 10MB 限制。', 413)
            from . import documents
            try:
                record = await anyio.to_thread.run_sync(service.save_document, name, content)
            except documents.DocumentError as exc:
                raise AssistantError('invalid_document', str(exc), 400)
            return JSONResponse({'file': record}, status_code=201)
        except AssistantError as exc:
            return failure(exc)

    @router.get('/permissions')
    async def permission_modes(request: Request):
        from ai_assistant import permissions
        return {'modes': permissions.MODES}

    @router.post('/conversations/{cid}/permission')
    async def set_permission(cid: str, request: Request):
        try:
            service, body = await service_for(request), await body_for(request)
            result = await anyio.to_thread.run_sync(service.set_permission, cid, body.get('mode', ''))
            return result
        except AssistantError as exc:
            return failure(exc)

    @router.get('/models')
    async def models_list(request: Request):
        try:
            service = await models_service(request)
            result = await anyio.to_thread.run_sync(service.models.list, service.builtin_model())
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    async def models_service(request):
        if not desktop.allowed(request):
            raise AssistantError('desktop_required', '模型配置仅可从本机 Windows 桌面访问。', 403)
        return await service_for(request)

    @router.post('/models')
    async def models_add(request: Request):
        try:
            service, body = await models_service(request), await body_for(request)
            provider = await anyio.to_thread.run_sync(service.models.put, body)
            return JSONResponse({'provider': provider}, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.patch('/models/{provider_id}')
    async def models_update(provider_id: str, request: Request):
        try:
            service, body = await models_service(request), await body_for(request)
            provider = await anyio.to_thread.run_sync(service.models.put, body, provider_id)
            return JSONResponse({'provider': provider}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/models/active')
    async def models_active(request: Request):
        try:
            service, body = await models_service(request), await body_for(request)
            result = await anyio.to_thread.run_sync(service.models.set_active, body.get('id'))
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.patch('/model-providers/{group_id}')
    async def model_provider_update(group_id: str, request: Request):
        try:
            service, body = await models_service(request), await body_for(request)
            result = await anyio.to_thread.run_sync(service.models.update_group, group_id, body)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/models/{model_id}/test')
    async def model_test(model_id: str, request: Request):
        try:
            service, body = await models_service(request), await body_for(request)
            if body:
                raise ModelError('invalid_model_test', '请选择已保存的模型测试连接。')
            result = await anyio.to_thread.run_sync(service.test_model, model_id)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.delete('/models/{provider_id}')
    async def models_delete(provider_id: str, request: Request):
        try:
            service = await models_service(request)
            result = await anyio.to_thread.run_sync(service.models.remove, provider_id)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.get('/workspaces')
    async def workspaces(request: Request):
        try:
            service = await service_for(request)
            rows = await anyio.to_thread.run_sync(service.workspaces)
            if not desktop.allowed(request):
                rows = [dict(row, root_path=None, source_folders=[]) for row in rows]
            return JSONResponse({'workspaces': rows}, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/workspaces')
    async def create_workspace(request: Request):
        try:
            service, body = await service_for(request), await body_for(request)
            fields = workspace_fields(request, body, creating=True)
            result = await anyio.to_thread.run_sync(lambda: service.create_workspace(
                fields.get('name', ''), source_folders=fields.get('source_folders'),
                instructions=fields.get('instructions', ''), memory_mode=fields.get('memory_mode', 'default'),
                authorize=desktop.consume_many))
            return JSONResponse({'workspace': result}, status_code=201)
        except (AssistantError, ProjectFileError) as exc:
            return failure(exc)

    @router.patch('/workspaces/{wid}')
    async def update_workspace(wid: str, request: Request):
        try:
            require_desktop(request)
            service, body = await service_for(request), await body_for(request)
            fields = workspace_fields(request, body)
            return {'workspace': await anyio.to_thread.run_sync(service.update_workspace, wid, fields, desktop.consume_many)}
        except (AssistantError, ProjectFileError) as exc:
            return failure(exc)

    @router.delete('/workspaces/{wid}')
    async def delete_workspace(wid: str, request: Request):
        try:
            require_desktop(request)
            service = await service_for(request)
            return await anyio.to_thread.run_sync(service.delete_workspace, wid)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/workspaces/{wid}/development-target')
    async def workspace_development_target(wid: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            if 'name' not in body or set(body) - {'name', 'source', 'root_key'}:
                raise AssistantError('invalid_project_tool', '项目工具参数无效。')
            result = await anyio.to_thread.run_sync(service.workspace_development_target, wid,
                                                   body['name'], body.get('source'), body.get('root_key'))
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.get('/conversations')
    async def conversations(request: Request):
        try:
            service = await service_for(request)
            workspace = request.query_params.get('workspace') or None
            return {'conversations': await anyio.to_thread.run_sync(service.conversations, workspace)}
        except AssistantError as exc:
            return failure(exc)

    @router.get('/conversations/{cid}')
    async def history(cid: str, request: Request):
        try:
            service = await service_for(request)
            return await anyio.to_thread.run_sync(service.get, cid)
        except AssistantError as exc:
            return failure(exc)

    @router.get('/conversations/{cid}/file-proposals')
    async def file_proposals(cid: str, request: Request):
        try:
            require_desktop(request)
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(service.file_proposals, cid)
            return JSONResponse({'proposals': result}, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/file-proposals/{pid}/{decision}')
    async def decide_file_proposal(cid: str, pid: str, decision: str, request: Request):
        try:
            require_desktop(request)
            if decision not in ('approve', 'reject'):
                raise AssistantError('not_found', '接口不存在。', 404)
            service = await service_for(request)
            await body_for(request)
            result = await anyio.to_thread.run_sync(service.decide_file_proposal, cid, pid, decision)
            return JSONResponse({'proposal': result}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ProjectFileError) as exc:
            return failure(exc)

    @router.post('/conversations')
    async def create(request: Request):
        try:
            service, body = await service_for(request), await body_for(request)
            result = await anyio.to_thread.run_sync(service.create, body.get('title', AUTO_TITLE), body.get('workspace'))
            return JSONResponse({'conversation': result}, status_code=201)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns')
    async def begin_external_turn(cid: str, request: Request):
        try:
            if not desktop.allowed(request):
                raise AssistantError('desktop_required', '外部 Agent 会话仅可从本机 Windows 桌面访问。', 403)
            service, body = await service_for(request), await body_for(request)
            if set(body) - {'content', 'agent_id', 'agent_name', 'model', 'attachments', 'file_ids', 'analysis_file_id', 'skill_ids', 'plugin_ids'}:
                raise AssistantError('invalid_external_turn', '外部 Agent 消息字段无效。')
            result = await anyio.to_thread.run_sync(lambda: service.begin_external_turn(
                cid, body.get('content', ''), body.get('agent_id'), body.get('agent_name'), body.get('model'),
                attachments=body.get('attachments'), file_ids=body.get('file_ids'),
                analysis_file_id=body.get('analysis_file_id'), skill_ids=body.get('skill_ids'),
                plugin_ids=body.get('plugin_ids', []),
                local_tables=getattr(request.app.state, 'deep_analysis_service', None),
                remote_data=getattr(request.app.state, 'remote_data', None),
                mcp_registry=getattr(request.app.state, 'mcp_registry', None)))
            return JSONResponse(result, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, AnalysisError, SkillError, BundleError) as exc:
            return failure(exc)

    async def worktree_action(cid, action, request):
        try:
            require_desktop(request, native=True)
            service, fields = await service_for(request), await body_for(request)
            if action == 'worktree-target' and set(fields) == {'source'}:
                result = await anyio.to_thread.run_sync(service.worktree_target, cid, fields['source'])
            elif action == 'worktree' and set(fields) == {'source', 'base_root_key', 'root_path', 'branch', 'commit'}:
                result = await anyio.to_thread.run_sync(lambda: service.bind_worktree(cid, **fields))
            elif action == 'worktree-location' and not fields:
                result = await anyio.to_thread.run_sync(service.worktree_location, cid)
            elif action == 'development-target' and 'name' in fields and not set(fields) - {'name', 'source', 'root_key'}:
                result = await anyio.to_thread.run_sync(lambda: service.conversation_development_target(cid, **fields))
            else:
                raise AssistantError('invalid_worktree', '工作树或项目工具请求参数无效。')
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ProjectFileError) as exc:
            return failure(exc)

    @router.post('/external-files')
    async def upload_external_file(request: Request):
        try:
            if not desktop.allowed(request):
                raise AssistantError('desktop_required', '外部 Agent 附件使用本机 Windows 桌面。', 403)
            service = await service_for(request)
            raw = bytearray()
            async for chunk in request.stream():
                if len(raw) + len(chunk) > TABLE_UPLOAD_LIMIT:
                    raise AssistantError('request_too_large', '表格文件不能超过 5 MiB。', 413)
                raw.extend(chunk)
            name = unquote(request.headers.get('X-Filename', 'data.csv'))
            store = await anyio.to_thread.run_sync(service.external_table_store)
            file = await anyio.to_thread.run_sync(store.upload, TABLE_OWNER, name, bytes(raw))
            return JSONResponse({'file': file}, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, AnalysisError) as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns/{turn_id}/prepare')
    async def prepare_external_turn(cid: str, turn_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            if set(body) != {'agent_id'}:
                raise AssistantError('invalid_external_turn', '外部 Agent 标识无效。')
            result = await anyio.to_thread.run_sync(service.prepare_external_turn, cid, turn_id, body['agent_id'])
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ProjectFileError) as exc:
            return failure(exc)

    @router.get('/company-runtime')
    async def company_runtime_status(request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(company_runtime.selected, service, request.query_params.get('model_id'))
            return JSONResponse({'ready': result is not None}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns/{turn_id}/company-provider/chat/completions')
    async def company_provider(cid: str, turn_id: str, request: Request):
        try:
            header = request.headers.getlist('authorization')
            if (not desktop.local(request) or len(header) != 1 or not header[0].startswith('Bearer ')
                    or len(header[0]) != 71 or any(ch not in '0123456789abcdef' for ch in header[0][7:])):
                raise AssistantError('invalid_company_relay', '公司模型请求未授权。', 403)
            service, body = await service_for(request), await body_for(request, company_runtime.RELAY_LIMIT)
            response, cancel, lease = await anyio.to_thread.run_sync(service.open_company_stream, cid, turn_id, header[0][7:], body)
        except AssistantError as exc:
            return failure(exc)

        def close_stream():
            try:
                response.close()
            finally:
                lease.release()

        async def chunks():
            try:
                while data := await anyio.to_thread.run_sync(company_runtime.read_response, response, cancel):
                    yield data
            finally:
                close_stream()

        return StreamingResponse(chunks(), media_type='text/event-stream', headers={'Cache-Control': 'no-store'})

    @router.post('/conversations/{cid}/external-turns/{turn_id}/project-file')
    async def external_project_file(cid: str, turn_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            if set(body) - {'agent_id', 'action', 'source', 'path', 'line', 'limit', 'content', 'expected_sha256'}:
                raise AssistantError('invalid_file_action', '项目文件操作参数无效。')
            result = await anyio.to_thread.run_sync(service.external_project_file, cid, turn_id, body.get('agent_id'), body)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ProjectFileError) as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns/{turn_id}/tool')
    async def call_external_tool(cid: str, turn_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            if not {'agent_id', 'name', 'arguments'} <= set(body) or set(body) - {'agent_id', 'name', 'arguments', 'confirmed'}:
                raise AssistantError('invalid_external_tool', '外部 Agent 工具参数无效。')
            result = await anyio.to_thread.run_sync(service.call_external_tool, cid, turn_id,
                                                  body['agent_id'], body['name'], body['arguments'], body.get('confirmed') is True)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns/{turn_id}/project-root')
    async def external_development_target(cid: str, turn_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            if not {'agent_id', 'name'} <= set(body) or set(body) - {'agent_id', 'name', 'source', 'root_key'}:
                raise AssistantError('invalid_project_tool', '项目工具参数无效。')
            result = await anyio.to_thread.run_sync(service.external_development_target, cid, turn_id,
                                                   body['agent_id'], body['name'], body.get('source'),
                                                   body.get('root_key'))
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns/{turn_id}/finish')
    async def finish_external_turn(cid: str, turn_id: str, request: Request):
        try:
            if not desktop.allowed(request):
                raise AssistantError('desktop_required', '外部 Agent 会话仅可从本机 Windows 桌面访问。', 403)
            service, body = await service_for(request), await body_for(request)
            if set(body) - {'content', 'status', 'model', 'execution', 'usage', 'recommendations', 'context'}:
                raise AssistantError('invalid_external_turn', '外部 Agent 回复格式无效。')
            result = await anyio.to_thread.run_sync(service.finish_external_turn, cid, turn_id,
                                                  body.get('content'), body.get('status'), body.get('model'),
                                                  body.get('execution'), body.get('usage'), body.get('recommendations'),
                                                  body.get('context'))
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.get('/conversations/{cid}/mcp-approvals')
    async def mcp_approvals(cid: str, request: Request):
        try:
            if not desktop.allowed(request):
                raise AssistantError('desktop_required', 'MCP 工具确认仅可从本机 Windows 桌面访问。', 403)
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(service.list_mcp_approvals, cid)
            return JSONResponse({'approvals': result}, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/development-jobs/{job_id}/{action}')
    async def development_job(cid: str, job_id: str, action: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            if action == 'claim' and not body:
                result = await anyio.to_thread.run_sync(service.development_claim, cid, job_id)
            elif action == 'target' and not set(body) - {'source', 'root_key'}:
                result = await anyio.to_thread.run_sync(service.development_target, cid, job_id,
                                                       body.get('source'), body.get('root_key'))
            elif action == 'complete' and set(body) == {'result'}:
                result = await anyio.to_thread.run_sync(service.development_complete, cid, job_id, body['result'])
            else:
                raise AssistantError('invalid_development_request', '项目工具请求格式无效。')
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/mcp-approvals/{approval_id}/{decision}')
    async def decide_mcp_approval(cid: str, approval_id: str, decision: str, request: Request):
        try:
            if not desktop.allowed(request):
                raise AssistantError('desktop_required', 'MCP 工具确认仅可从本机 Windows 桌面访问。', 403)
            if decision not in ('approve', 'reject'):
                raise AssistantError('not_found', '接口不存在。', 404)
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(service.decide_mcp_approval, cid, approval_id, decision)
            return JSONResponse({'approval': result}, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/delegations/{request_id}')
    async def complete_delegation(cid: str, request_id: str, request: Request):
        try:
            require_desktop(request)
            service = await service_for(request)
            body = await body_for(request, 128 * 1024)
            result = await anyio.to_thread.run_sync(service.complete_delegation, cid, request_id, body)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/{action}')
    async def mutate(cid: str, action: str, request: Request):
        if action in ('worktree-target', 'worktree', 'worktree-location', 'development-target'):
            return await worktree_action(cid, action, request)
        try:
            service, body = await service_for(request), await body_for(request)
            if action == 'rename':
                return {'conversation': await anyio.to_thread.run_sync(service.rename, cid, body.get('title'))}
            if action == 'delete':
                return await anyio.to_thread.run_sync(service.delete, cid)
            if action == 'cancel':
                return {'cancelled': await anyio.to_thread.run_sync(service.cancel, cid)}
            if action != 'messages':
                raise AssistantError('not_found', '接口不存在。', 404)
            mode = getattr(request.app.state, 'session_mode', 'shared')
            owner = 'local_shared' if mode == 'shared' else request.scope.get('state', {}).get('deep_analysis_context')
            import os as _os
            tool_context = dict(share=_os.getenv('SHARE_MODE', '').strip() == '1', owner=owner, analysis_file_id=body.get('analysis_file_id') or None,
                                analysis_file_meta=body.get('analysis_file_meta') or None,
                                file_ids=body.get('file_ids') or [], project_desktop=desktop.allowed(request),
                                model_id=body.get('model_id'), reasoning_effort=body.get('reasoning_effort'))
            agent_catalog = body.get('delegation_agents', [])
            if agent_catalog != []:
                require_desktop(request)
                try:
                    tool_context['delegation_agents'] = delegation.catalog(agent_catalog)
                except ValueError as exc:
                    raise AssistantError('invalid_delegation_agents', str(exc)) from exc
            from mcp_connectors.asgi import local_access
            if local_access(request, require_browser_proof=False):
                tool_context['mcp_registry'] = request.app.state.mcp_registry
            skill_ids, plugin_ids = body.get('skill_ids', []), body.get('plugin_ids', [])
            if plugin_ids != [] and not tool_context['project_desktop']:
                raise AssistantError('desktop_required', '插件仅可从本机 Windows 桌面管理和选择。', 403)
            if skill_ids != []:
                require_personal_skills(request)
            if skill_ids != [] or plugin_ids != []:
                skills, scope = await anyio.to_thread.run_sync(service.turn_extensions, skill_ids, plugin_ids,
                                                              tool_context.get('mcp_registry'))
                tool_context.update(selected_skills=skills, plugin_mcp_ids=scope)
            user, assistant, cancel = await anyio.to_thread.run_sync(service.begin, cid, body.get('content', ''), body.get('attachments'), tool_context)
        except (AssistantError, ModelError, SkillError, BundleError) as exc:
            return failure(exc)

        async def events():
            stream = service.stream(cid, user, assistant, cancel)
            def advance():
                try:
                    return next(stream)
                except StopIteration:
                    return None
            try:
                while True:
                    item = await anyio.to_thread.run_sync(advance)
                    if item is None:
                        break
                    event, packet = item
                    yield ('event: ' + event + '\ndata: ' + json.dumps(packet, ensure_ascii=False) + '\n\n').encode()
            finally:
                cancel.set()
                # Shield cleanup after ASGI cancellation. No simultaneous next()/close().
                with anyio.CancelScope(shield=True):
                    def cleanup():
                        try:
                            stream.close()
                        finally:
                            if assistant['status'] == 'streaming':
                                assistant['status'] = 'cancelled'
                                service.save(cid, assistant)
                            service.release(cid, cancel)
                    await anyio.to_thread.run_sync(cleanup)
        return StreamingResponse(events(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache, no-store', 'X-Accel-Buffering': 'no'})

    return router
