"""Native ASGI conversation routes; synchronous model work stays in worker threads."""
import json
import os
import re
from urllib.parse import unquote
from urllib.request import Request as UrlRequest, urlopen
import anyio
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from deep_analysis.service import AnalysisError
from . import company_runtime, delegation, plugin_package
from .configuration_checkpoints import ConfigurationCheckpoints
from .document_library import DocumentLibrary, DocumentLibraryError
from .external_context import TABLE_OWNER, TABLE_UPLOAD_LIMIT
from .models import BUILTIN, ModelError
from .runtime_tasks import TaskError
from .project_access import DesktopAccess
from .project_files import ProjectFileError
from .plugin_bundles import BundleError, MAX_MANIFEST_BYTES
from .service import AUTO_TITLE, AssistantError
from .skill_library import MAX_UPLOAD as SKILL_UPLOAD_LIMIT, SkillError
from .web_data_mcp import MAX_BODY_BYTES as WEB_MCP_BODY_LIMIT

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

    @router.get('/configuration-checkpoints')
    async def configuration_checkpoints(request: Request):
        try:
            service, registry = await plugin_access(request)
            result = await anyio.to_thread.run_sync(ConfigurationCheckpoints(service, registry).list)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/configuration-checkpoints')
    async def save_configuration_checkpoint(request: Request):
        try:
            service, registry = await plugin_access(request)
            body = await body_for(request, 2048)
            agent, revision = body.get('agent'), body.get('revision')
            if set(body) - {'agent', 'revision'} or not isinstance(revision, str):
                raise ModelError('invalid_checkpoint', '检查点验证请求无效。')
            if agent is not None and not desktop.allowed(request, native=True):
                raise ModelError('checkpoint_acp_required', '请在桌面端验证 ACP Agent。', 403)
            if agent is not None and (
                not isinstance(agent, dict) or set(agent) != {'id', 'name'}
                or not isinstance(agent['id'], str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', agent['id'])
                or not isinstance(agent['name'], str) or not 0 < len(agent['name']) <= 120
                or any(ord(char) < 32 or 0xd800 <= ord(char) <= 0xdfff for char in agent['name'])
            ):
                raise ModelError('invalid_checkpoint_agent', '请选择已配置的 ACP Agent。')
            result = await anyio.to_thread.run_sync(ConfigurationCheckpoints(service, registry).save, agent, revision)
            return JSONResponse(result, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/configuration-checkpoints/{checkpoint_id}/restore')
    async def restore_configuration_checkpoint(checkpoint_id: str, request: Request):
        try:
            service, registry = await plugin_access(request)
            result = await anyio.to_thread.run_sync(ConfigurationCheckpoints(service, registry).restore, checkpoint_id)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

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

    @router.get('/plugins/development/template')
    async def plugin_development_template(request: Request):
        try:
            service, _ = await plugin_access(request)
            return JSONResponse({'manifest': service.plugins.development_template()},
                                headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/plugins/portable/export')
    async def export_portable_plugin(request: Request):
        try:
            service, registry = await plugin_access(request)
            manifest = await body_for(request, MAX_MANIFEST_BYTES)
            data = await anyio.to_thread.run_sync(plugin_package.export, service.plugins, manifest, registry)
            return JSONResponse(data, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError, SkillError) as exc:
            return failure(exc)

    @router.post('/plugins/portable/preflight')
    async def preflight_portable_plugin(request: Request):
        try:
            service, registry = await plugin_access(request)
            package = await body_for(request, plugin_package.MAX_PACKAGE_BYTES)
            report = await anyio.to_thread.run_sync(plugin_package.preflight, service.plugins, package, registry)
            return JSONResponse({'report': report}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError, SkillError) as exc:
            return failure(exc)

    @router.post('/plugins/portable/import')
    async def import_portable_plugin(request: Request):
        try:
            service, registry = await plugin_access(request)
            package = await body_for(request, plugin_package.MAX_PACKAGE_BYTES)
            plugin = await anyio.to_thread.run_sync(plugin_package.install, service.plugins, package, registry)
            return JSONResponse({'plugin': plugin}, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError, SkillError) as exc:
            return failure(exc)

    @router.post('/plugins/development/preflight')
    async def plugin_development_preflight(request: Request):
        try:
            service, registry = await plugin_access(request)
            fields = await body_for(request, MAX_MANIFEST_BYTES)
            report = await anyio.to_thread.run_sync(service.plugins.preflight, fields, registry)
            return JSONResponse({'report': report}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.get('/plugins/development/candidates')
    async def list_plugin_candidates(request: Request):
        try:
            service, _ = await default_plugin_management(request)
            candidates = await anyio.to_thread.run_sync(service.plugins.candidates)
            return JSONResponse({'candidates': candidates}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.post('/plugins/development/candidates')
    async def create_plugin_candidate(request: Request):
        try:
            service, registry = await default_plugin_management(request)
            fields = await body_for(request, MAX_MANIFEST_BYTES)
            candidate = await anyio.to_thread.run_sync(service.plugins.create_candidate, fields, registry)
            return JSONResponse({'candidate': candidate}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, BundleError) as exc:
            return failure(exc)

    @router.get('/plugins/development/candidates/{candidate_id}')
    async def read_plugin_candidate(candidate_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, _ = await default_plugin_management(request)
            candidate = await anyio.to_thread.run_sync(service.plugins.candidate, candidate_id)
            return JSONResponse({'candidate': candidate}, headers={'Cache-Control': 'no-store'})
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
            mode = body.get('mode', '')
            if mode == 'full':
                require_desktop(request)
            result = await anyio.to_thread.run_sync(service.set_permission, cid, mode)
            return result
        except AssistantError as exc:
            return failure(exc)

    def runtime_failure(exc, service):
        return JSONResponse(dict(error=dict(code=exc.code, message=exc.message),
                                 task=exc.task, epoch=service.runtime_epoch), status_code=exc.status,
                            headers={'Cache-Control': 'no-store'})

    @router.get('/runtime-tasks')
    @router.get('/conversations/{cid}/runtime-tasks')
    async def runtime_tasks_snapshot(request: Request, cid: str = None, conversation_id: str = None, after: str = None, epoch: str = None):
        try:
            if not desktop.allowed(request):
                raise AssistantError('desktop_required', '任务状态仅可从本机桌面访问。', 403)
            if after is not None and (not after.isdigit() or len(after) > 16):
                raise AssistantError('invalid_runtime_cursor', '任务状态游标无效。')
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(service.runtime_task_snapshot, cid or conversation_id,
                                                   int(after) if after is not None else None, epoch)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/runtime-tasks/{task_id}/state')
    async def runtime_tasks_state(cid: str, task_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            return JSONResponse(await anyio.to_thread.run_sync(service.publish_runtime_task, cid, task_id, body),
                                headers={'Cache-Control': 'no-store'})
        except TaskError as exc:
            return runtime_failure(exc, service)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/runtime-tasks/{task_id}/finish')
    async def runtime_tasks_finish(cid: str, task_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            return JSONResponse(await anyio.to_thread.run_sync(service.finish_runtime_task, cid, task_id, body),
                                headers={'Cache-Control': 'no-store'})
        except TaskError as exc:
            return runtime_failure(exc, service)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/runtime-tasks/{task_id}/abandon')
    async def runtime_tasks_abandon(cid: str, task_id: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            return JSONResponse(await anyio.to_thread.run_sync(service.abandon_runtime_task, cid, task_id, body),
                                headers={'Cache-Control': 'no-store'})
        except TaskError as exc:
            return runtime_failure(exc, service)
        except AssistantError as exc:
            return failure(exc)

    async def native_session_action(request, method, ident):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            result = await anyio.to_thread.run_sync(getattr(service, method), ident, body)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except TaskError as exc:
            return runtime_failure(exc, service)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/native-history/authorize')
    async def native_history_authorize(cid: str, request: Request):
        return await native_session_action(request, 'native_history_authorize', cid)

    @router.post('/conversations/{cid}/native-sessions')
    async def native_session_bind(cid: str, request: Request):
        return await native_session_action(request, 'bind_native_session', cid)

    @router.get('/conversations/{cid}/native-sessions')
    async def native_session_mapping(cid: str, request: Request, agent_id: str):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            return JSONResponse(await anyio.to_thread.run_sync(service.native_session_mapping,cid,agent_id), headers={'Cache-Control':'no-store'})
        except TaskError as exc:
            return runtime_failure(exc,service)
        except AssistantError as exc:
            return failure(exc)

    @router.get('/conversations/{cid}/child-conversations')
    async def native_child_conversation(cid: str, request: Request, turn_id: str, child_id: str):
        try:
            require_desktop(request, native=True)
            service=await service_for(request)
            result=await anyio.to_thread.run_sync(service.native_child_conversation,cid,turn_id,child_id)
            return JSONResponse(result,headers={'Cache-Control':'no-store'})
        except TaskError as exc:
            return runtime_failure(exc,service)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/native-forks')
    async def native_fork_reserve(cid: str, request: Request):
        return await native_session_action(request, 'reserve_native_fork', cid)

    @router.post('/native-forks/{rid}/history/pages')
    async def native_fork_history_page(rid: str,request:Request):
        return await native_session_action(request,'append_native_fork_history',rid)

    @router.get('/conversations/{cid}/native-preferences')
    async def get_native_preferences(cid:str,request:Request):
        try:
            require_desktop(request,native=True)
            service=await service_for(request)
            return JSONResponse(await anyio.to_thread.run_sync(service.native_conversation_preferences,cid),headers={'Cache-Control':'no-store'})
        except TaskError as exc:return runtime_failure(exc,service)
        except AssistantError as exc:return failure(exc)

    @router.put('/conversations/{cid}/native-preferences')
    async def put_native_preferences(cid:str,request:Request):
        return await native_session_action(request,'set_native_conversation_preferences',cid)

    @router.get('/conversations/{cid}/inherited-history')
    async def inherited_native_history(cid:str,request:Request,after:str|None=None,limit:int=50):
        try:
            require_desktop(request,native=True)
            service=await service_for(request)
            return JSONResponse(await anyio.to_thread.run_sync(service.inherited_native_history,cid,after,limit),headers={'Cache-Control':'no-store'})
        except TaskError as exc:return runtime_failure(exc,service)
        except AssistantError as exc:return failure(exc)

    @router.post('/native-forks/{rid}/commit')
    async def native_fork_commit(rid: str, request: Request):
        return await native_session_action(request, 'commit_native_fork', rid)

    @router.post('/native-forks/{rid}/abort')
    async def native_fork_abort(rid: str, request: Request):
        return await native_session_action(request, 'abort_native_fork', rid)

    @router.get('/conversations/{cid}/agent-mode')
    async def get_agent_mode(cid: str, request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            return JSONResponse(await anyio.to_thread.run_sync(service.agent_mode, cid), headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/agent-mode')
    async def set_agent_mode(cid: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request)
            if set(body) != {'agent_mode'}:
                raise AssistantError('invalid_agent_mode', '工作模式请求参数无效。')
            return JSONResponse(await anyio.to_thread.run_sync(service.set_agent_mode, cid, body['agent_mode']),
                                headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.get('/models')
    async def models_list(request: Request):
        try:
            service = await models_service(request)
            result = await anyio.to_thread.run_sync(service.models.list, service.builtin_model())
            result['company_models'] = await anyio.to_thread.run_sync(service.company_models)
            if company_runtime.configured_providers_only():
                result['providers'] = [row for row in result['providers'] if not row['builtin']]
                result['company_models'] = []
                if result['active'] == BUILTIN:
                    result['active'] = ''
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    async def models_service(request):
        if not desktop.allowed(request):
            raise AssistantError('desktop_required', '模型配置仅可从本机 Windows 桌面访问。', 403)
        return await service_for(request)

    @router.get('/company-provider')
    @router.patch('/company-provider')
    @router.delete('/company-provider')
    async def company_provider(request: Request):
        try:
            service = await models_service(request)
            changes = (await body_for(request, 16384)) if request.method == 'PATCH' else None if request.method == 'DELETE' else False
            result = await anyio.to_thread.run_sync(service.company_key_view, changes)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

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

    @router.post('/model-providers/discover')
    async def model_provider_discover(request: Request):
        try:
            service, body = await models_service(request), await body_for(request)
            models = await anyio.to_thread.run_sync(service.models.discover, body)
            return JSONResponse({'models': models}, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/model-providers/models')
    async def model_provider_add_discovered(request: Request):
        try:
            service, body = await models_service(request), await body_for(request)
            providers = await anyio.to_thread.run_sync(service.models.add_discovered, body)
            return JSONResponse({'providers': providers}, headers={'Cache-Control': 'no-store'})
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

    @router.get('/session-index')
    async def session_index(request: Request):
        try:
            service = await service_for(request)
            return await anyio.to_thread.run_sync(service.session_index)
        except AssistantError as exc:
            return failure(exc)

    @router.get('/conversations/{cid}')
    async def history(cid: str, request: Request):
        try:
            service = await service_for(request)
            return await anyio.to_thread.run_sync(service.get, cid)
        except AssistantError as exc:
            return failure(exc)

    @router.get('/conversations/{cid}/trace')
    async def conversation_trace(cid: str, request: Request):
        try:
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(service.conversation_trace, cid)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/agent-members')
    async def change_conversation_agents(cid: str, request: Request):
        try:
            require_desktop(request)
            service, body = await service_for(request), await body_for(request, limit=1024)
            if set(body) != {'agent_id', 'added'}:
                raise AssistantError('invalid_external_agent', 'Agent 成员请求字段无效。')
            result = await anyio.to_thread.run_sync(service.set_conversation_agent, cid, body['agent_id'], body['added'])
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
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

    @router.get('/conversations/{cid}/workspace-files')
    async def workspace_files(cid: str, request: Request):
        try:
            require_desktop(request)
            service = await service_for(request)
            query = request.query_params
            if (set(query) - {'source', 'folder', 'file'} or ('folder' in query and 'file' in query)
                    or len(query.multi_items()) != len(query)):
                raise AssistantError('invalid_workspace_files', '请输入单一项目目录或文件。')
            payload = await anyio.to_thread.run_sync(service.workspace_files, cid, query.get('source'),
                                                    query.get('folder'), query.get('file'))
            return JSONResponse(payload, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ProjectFileError) as exc:
            response = failure(exc)
            response.headers['Cache-Control'] = 'no-store'
            return response

    @router.post('/conversations/{cid}/file-proposals/{pid}/open-target')
    async def proposal_open_target(cid: str, pid: str, request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            if await body_for(request, limit=1024):
                raise AssistantError('invalid_file_action', '打开文件不需要额外路径参数。')
            result = await anyio.to_thread.run_sync(service.proposal_open_target, cid, pid)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ProjectFileError) as exc:
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
            mode = body.get('permission_mode', 'read_only')
            if mode == 'full':
                require_desktop(request)
            agent_mode = body.get('agent_mode')
            if agent_mode is not None:
                require_desktop(request, native=True)
            result = await anyio.to_thread.run_sync(service.create, body.get('title', AUTO_TITLE), body.get('workspace'), mode, agent_mode)
            return JSONResponse({'conversation': result}, status_code=201)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/branch')
    async def branch(cid: str, request: Request):
        try:
            service, body = await service_for(request), await body_for(request, limit=1024)
            if set(body) != {'message_id'}:
                raise AssistantError('invalid_branch_message', '请选择要从中分支的回答。')
            result = await anyio.to_thread.run_sync(service.branch, cid, body['message_id'])
            return JSONResponse({'conversation': result}, status_code=201, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns')
    async def begin_external_turn(cid: str, request: Request):
        try:
            if not desktop.allowed(request):
                raise AssistantError('desktop_required', '外部 Agent 会话仅可从本机 Windows 桌面访问。', 403)
            service, body = await service_for(request), await body_for(request)
            if set(body) - {'content', 'agent_id', 'agent_name', 'model', 'attachments', 'file_ids', 'analysis_file_id',
                            'skill_ids', 'plugin_ids', 'company_model', 'reasoning_effort', 'queue_id', 'member_only',
                            'group_parallel', 'provider_model_id'}:
                raise AssistantError('invalid_external_turn', '外部 Agent 消息字段无效。')
            result = await anyio.to_thread.run_sync(lambda: service.begin_external_turn(
                cid, body.get('content', ''), body.get('agent_id'), body.get('agent_name'), body.get('model'),
                company_model=body.get('company_model'), reasoning_effort=body.get('reasoning_effort'),
                provider_model_id=body.get('provider_model_id'),
                queue_id=body.get('queue_id'), member_only=body.get('member_only', False),
                group_parallel=body.get('group_parallel', False),
                attachments=body.get('attachments'), file_ids=body.get('file_ids'),
                analysis_file_id=body.get('analysis_file_id'), skill_ids=body.get('skill_ids'),
                plugin_ids=body.get('plugin_ids', []),
                local_tables=getattr(request.app.state, 'deep_analysis_service', None),
                remote_data=getattr(request.app.state, 'remote_data', None),
                mcp_registry=getattr(request.app.state, 'mcp_registry', None)))
            return JSONResponse(result, status_code=201, headers={'Cache-Control': 'no-store'})
        except (AssistantError, AnalysisError, SkillError, BundleError, ModelError) as exc:
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

    @router.post('/conversations/{cid}/external-turns/{turn_id}/steers')
    async def reserve_native_steer(cid: str, turn_id: str, request: Request):
        try:
            require_desktop(request)
            service, body = await service_for(request), await body_for(request, 64 * 1024)
            if set(body) != {'content'}:
                raise AssistantError('invalid_external_steer', '引导消息格式无效。')
            result = await anyio.to_thread.run_sync(service.reserve_native_steer, cid, turn_id, body['content'])
            return JSONResponse(result, status_code=201, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/conversations/{cid}/external-turns/{turn_id}/steers/{steer_id}/{action}')
    async def native_steer(cid: str, turn_id: str, steer_id: str, action: str, request: Request):
        try:
            require_desktop(request, native=True)
            service, body = await service_for(request), await body_for(request, 1024)
            if action == 'prepare' and set(body) == {'agent_id'}:
                accepted = None
            elif action == 'finish' and set(body) == {'agent_id', 'accepted'} and type(body['accepted']) is bool:
                accepted = body['accepted']
            else:
                raise AssistantError('invalid_external_steer', '引导消息回传格式无效。')
            result = await anyio.to_thread.run_sync(lambda: service.native_steer(
                cid, turn_id, steer_id, body['agent_id'], accepted=accepted))
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
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
            return JSONResponse(dict(ready=result is not None, **(result or {})), headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.post('/company-web-runtime')
    async def start_company_web_runtime(request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            runtime = await anyio.to_thread.run_sync(service.start_company_web_runtime,
                                                      getattr(request.app.state, 'remote_data', None))
            return JSONResponse(runtime, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.delete('/company-web-runtime/{ident}')
    async def stop_company_web_runtime(ident: str, request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            result = await anyio.to_thread.run_sync(service.stop_company_web_runtime, ident)
            return JSONResponse(result, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/dsh-next-runtime')
    async def begin_dsh_next_runtime(request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            record = await anyio.to_thread.run_sync(service.dsh_next_runtime.open,
                                                     getattr(request.app.state, 'remote_data', None))
            return JSONResponse(record, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.get('/dsh-next-runtime/{ident}/catalog')
    async def dsh_next_model_catalog(ident: str, request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            record = await anyio.to_thread.run_sync(service.dsh_next_runtime.catalog, ident)
            if record is None:
                raise AssistantError('invalid_next_host', 'Somnus model host is no longer available', 404)
            return JSONResponse(record, headers={'Cache-Control': 'no-store'})
        except (AssistantError, ModelError) as exc:
            return failure(exc)

    @router.delete('/dsh-next-runtime/{ident}')
    async def close_dsh_next_runtime(ident: str, request: Request):
        try:
            require_desktop(request, native=True)
            service = await service_for(request)
            revoked = await anyio.to_thread.run_sync(service.dsh_next_runtime.close, ident)
            return JSONResponse({'revoked': revoked}, headers={'Cache-Control': 'no-store'})
        except AssistantError as exc:
            return failure(exc)

    @router.post('/dsh-next-runtime/{ident}/provider/chat/completions')
    @router.post('/dsh-next-runtime/{ident}/provider/responses')
    @router.post('/company-web-runtime/{ident}/provider/chat/completions')
    @router.post('/company-web-runtime/{ident}/provider/responses')
    @router.post('/company-web-runtime/{ident}/provider/v1/messages')
    async def company_web_provider(ident: str, request: Request):
        try:
            anthropic = request.url.path.endswith('/v1/messages')
            token = company_provider_token(request, anthropic=anthropic)
            service, body = await service_for(request), await body_for(request, company_runtime.RELAY_LIMIT)
            if body.get('model') == 'codex':
                url = os.getenv('SOMNUS_ACP_URL', '').rstrip('/')
                acp_token = os.getenv('SOMNUS_ACP_TOKEN', '')
                if not url or not acp_token:
                    raise AssistantError('acp_unavailable', 'Codex ACP 尚未就绪。', 503)
                payload = dict(body, stream=False)

                def relay():
                    request_ = UrlRequest(url + '/v1/chat/completions', data=json.dumps(payload).encode('utf-8'),
                                          headers={'Content-Type': 'application/json',
                                                   'Authorization': 'Bearer ' + acp_token}, method='POST')
                    with urlopen(request_, timeout=300) as response:
                        return response.status, response.read()

                status, raw = await anyio.to_thread.run_sync(relay)
                return Response(content=raw, status_code=status, media_type='application/json')
            responses = company_runtime.MESSAGES_API if anthropic else request.url.path.endswith('/responses')
            open_stream = (service.open_dsh_next_stream if '/dsh-next-runtime/' in request.url.path
                           else service.open_company_web_stream)
            stream = await anyio.to_thread.run_sync(open_stream, ident, token, body, responses)
            return company_provider_response(*stream)
        except AssistantError as exc:
            return failure(exc)

    async def dispatch_company_mcp(ident, request, server_id=None, *, dsh_next=False):
        try:
            token = company_provider_token(request)
            service, body = await service_for(request), await body_for(request, WEB_MCP_BODY_LIMIT)
            dispatch = service.dispatch_dsh_next_mcp if dsh_next else service.dispatch_company_web_mcp
            packet = await anyio.to_thread.run_sync(dispatch, ident, token, body, server_id)
            headers = {'Cache-Control': 'no-store'}
            if packet is None:
                return Response(status_code=202, headers=headers)
            return JSONResponse(packet, headers=headers)
        except AssistantError as exc:
            return failure(exc)

    @router.post('/company-web-runtime/{ident}/mcp')
    async def company_web_mcp(ident: str, request: Request):
        return await dispatch_company_mcp(ident, request)

    @router.post('/company-web-runtime/{ident}/mcp/{server_id}')
    async def company_web_named_mcp(ident: str, server_id: str, request: Request):
        return await dispatch_company_mcp(ident, request, server_id)

    @router.post('/dsh-next-runtime/{ident}/mcp/{server_id}')
    async def dsh_next_named_mcp(ident: str, server_id: str, request: Request):
        return await dispatch_company_mcp(ident, request, server_id, dsh_next=True)

    def company_provider_token(request, *, anthropic=False):
        if anthropic:
            headers = request.headers.getlist('x-api-key')
            if (not desktop.local(request) or len(headers) != 1 or not re.fullmatch(r'[0-9a-f]{64}', headers[0])):
                raise AssistantError('invalid_company_relay', '模型请求未授权。', 403)
            return headers[0]
        headers = request.headers.getlist('authorization')
        if (not desktop.local(request) or len(headers) != 1 or not re.fullmatch(r'Bearer [0-9a-f]{64}', headers[0])):
            raise AssistantError('invalid_company_relay', '公司模型请求未授权。', 403)
        return headers[0][7:]

    def company_provider_response(response, cancel, lease):
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

    @router.post('/conversations/{cid}/external-turns/{turn_id}/cancel')
    async def cancel_group_turn(cid: str, turn_id: str, request: Request):
        try:
            require_desktop(request)
            service, body = await service_for(request), await body_for(request, limit=1024)
            if set(body) != {'agent_id'} or not isinstance(body['agent_id'], str):
                raise AssistantError('invalid_external_turn', 'Agent 任务目标无效。')
            result = await anyio.to_thread.run_sync(service.cancel_group_turn, cid, turn_id, body['agent_id'])
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

    @router.get('/delegation-settings')
    @router.patch('/delegation-settings')
    async def delegation_settings(request: Request):
        try:
            require_desktop(request)
            service = await service_for(request)
            changes = await body_for(request) if request.method == 'PATCH' else None
            settings = await anyio.to_thread.run_sync(service.delegation_settings, changes)
            return JSONResponse(settings, headers={'Cache-Control': 'no-store'})
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
            if action == 'organize':
                return {'conversation': await anyio.to_thread.run_sync(service.organize_conversation, cid, body)}
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
            if body.get('queue_id') is not None:
                require_desktop(request)
                tool_context['queue_id'] = body['queue_id']
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

    documents = DocumentLibrary()

    def documents_for(request):
        if not desktop.allowed(request):
            raise AssistantError('desktop_required', '文档库仅可从本机 Windows 桌面访问。', 403)
        return documents

    def document_response(result):
        return JSONResponse(result, headers={'Cache-Control': 'no-store'})

    @router.get('/documents')
    async def documents_list(request: Request, scope: str = 'private', folder: str = ''):
        try:
            library = documents_for(request)
            result = await anyio.to_thread.run_sync(library.list, scope, folder)
            return document_response(result)
        except (AssistantError, DocumentLibraryError) as exc:
            return failure(exc)

    @router.post('/documents/folder')
    async def documents_create_folder(request: Request):
        try:
            library, body = documents_for(request), await body_for(request)
            if set(body) != {'folder', 'name'}:
                raise DocumentLibraryError('文件夹请求参数无效。')
            result = await anyio.to_thread.run_sync(library.create_folder, body['folder'], body['name'])
            return document_response(result)
        except (AssistantError, DocumentLibraryError) as exc:
            return failure(exc)

    @router.post('/documents/file')
    async def documents_create_file(request: Request):
        try:
            library, body = documents_for(request), await body_for(request)
            if set(body) != {'folder', 'name', 'content'}:
                raise DocumentLibraryError('文件请求参数无效。')
            result = await anyio.to_thread.run_sync(
                library.create_file, body['folder'], body['name'], body['content'])
            return document_response(result)
        except (AssistantError, DocumentLibraryError) as exc:
            return failure(exc)

    @router.post('/documents/import')
    async def documents_import(request: Request):
        try:
            library, body = documents_for(request), await body_for(request, 64 * 1024 * 1024)
            if set(body) != {'folder', 'files'}:
                raise DocumentLibraryError('导入请求参数无效。')
            result = await anyio.to_thread.run_sync(library.import_files, body['folder'], body['files'])
            return document_response(result)
        except (AssistantError, DocumentLibraryError) as exc:
            return failure(exc)

    @router.post('/documents/delete')
    async def documents_delete(request: Request):
        try:
            library, body = documents_for(request), await body_for(request)
            if set(body) != {'path'}:
                raise DocumentLibraryError('删除请求参数无效。')
            result = await anyio.to_thread.run_sync(library.delete_entry, body['path'])
            return document_response(result)
        except (AssistantError, DocumentLibraryError) as exc:
            return failure(exc)

    @router.get('/documents/read')
    async def documents_read(request: Request, scope: str = 'private', path: str = ''):
        try:
            library = documents_for(request)
            result = await anyio.to_thread.run_sync(library.read_file, scope, path)
            return document_response(result)
        except (AssistantError, DocumentLibraryError) as exc:
            return failure(exc)

    return router
