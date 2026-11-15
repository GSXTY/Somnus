"""FastAPI routes, using the host's same-origin and session boundaries."""
import csv
from datetime import date, timedelta
import io
import json
from pathlib import Path
from urllib.parse import unquote
from zipfile import BadZipFile, ZipFile

import anyio
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from .service import AnalysisError

# De-identified report export shipped with the trial; falls back to the generator.
SAMPLE_FILE = Path(__file__).with_name('sample_report.csv')


def sample_csv():
    if SAMPLE_FILE.is_file():
        return SAMPLE_FILE.read_text(encoding='utf-8')
    output = io.StringIO(newline='')
    writer = csv.writer(output)
    writer.writerow(['synthetic', 'userid', 'record_date', 'model', 'therapy_duration_seconds', 'device_ahi', 'waveform_missing_rate_percent'])
    for day in range(7):
        for user in range(80):
            writer.writerow(['true', f'SYNTHETIC-{user+1:03d}', (date(2026, 1, 1) + timedelta(days=day)).isoformat(),
                             ('YA70A20', 'YA70B20', 'YA70B25')[user % 3], (4 + user % 5) * 3600,
                             round(1 + ((user * 7 + day) % 120) / 10, 1), round(((user + day) % 13) / 10, 1)])
    return output.getvalue().encode('utf-8-sig')


def create_router(relay=None):
    router = APIRouter(prefix='/api/deep-analysis', tags=['深度分析试用'])

    def context(request):
        service = getattr(request.app.state, 'deep_analysis_service', None)
        if service is None:
            raise AnalysisError('service_unavailable', '深度分析试用服务尚未初始化。', 503)
        mode = getattr(request.app.state, 'session_mode', 'isolated')
        owner = 'local_shared' if mode == 'shared' else request.scope.get('state', {}).get('deep_analysis_context')
        if not owner:
            raise AnalysisError('context_unavailable', '深度分析会话未初始化。', 503)
        return service, owner

    def failure(exc):
        return JSONResponse({'error': {'code': exc.code, 'message': exc.message}}, status_code=exc.status)

    async def read_body(request, maximum):
        try:
            length = int(request.headers.get('content-length', '0'))
        except ValueError:
            raise AnalysisError('invalid_request', '请求长度无效。')
        if length < 0 or length > maximum:
            raise AnalysisError('request_too_large', '请求超过大小限制。', 413)
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > maximum:
                raise AnalysisError('request_too_large', '请求超过大小限制。', 413)
        return bytes(raw)

    @router.get('/status')
    async def status(request: Request):
        if relay is not None:
            return await relay(request)
        try:
            service, _ = context(request)
            return await anyio.to_thread.run_sync(service.status)
        except AnalysisError as exc:
            return failure(exc)

    @router.get('/sample.csv')
    async def sample(request: Request):
        if relay is not None:
            return await relay(request)
        try:
            context(request)
            return Response(sample_csv(), media_type='text/csv', headers={'Content-Disposition': 'attachment; filename="synthetic-ya70-daily.csv"', 'Cache-Control': 'no-store'})
        except AnalysisError as exc:
            return failure(exc)

    @router.post('/files')
    async def upload(request: Request):
        if relay is not None:
            return await relay(request)
        try:
            service, owner = context(request)
            raw = await read_body(request, service.config.max_file_bytes)
            name = unquote(request.headers.get('x-filename', 'data.csv'))
            normalized_name = name.replace('\\', '/').split('/')[-1][:120]
            if request.scope.get('state', {}).get('remote_deep_upload') and Path(normalized_name).suffix.lower() in ('.xlsx', '.xlsm'):
                await anyio.to_thread.run_sync(_check_remote_excel, raw)
            file = await anyio.to_thread.run_sync(service.upload, owner, name, raw)
            return JSONResponse({'file': file}, status_code=201)
        except AnalysisError as exc:
            return failure(exc)

    @router.post('/tasks')
    async def create(request: Request):
        if relay is not None:
            return await relay(request)
        try:
            service, owner = context(request)
            try:
                body = json.loads(await read_body(request, 65536))
            except (ValueError, UnicodeDecodeError):
                raise AnalysisError('invalid_json', '请求必须为有效 JSON。')
            if not isinstance(body, dict):
                raise AnalysisError('invalid_request', '请求必须为对象。')
            task = await anyio.to_thread.run_sync(service.create_task, owner, body.get('file_id'), body.get('question'))
            return JSONResponse({'task': task}, status_code=202)
        except AnalysisError as exc:
            return failure(exc)

    @router.get('/tasks')
    async def task_list(request: Request, limit: int = 20):
        if relay is not None:
            return await relay(request)
        try:
            service, owner = context(request)
            items = await anyio.to_thread.run_sync(service.recent_tasks, owner, limit)
            return {'tasks': items}
        except AnalysisError as exc:
            return failure(exc)

    @router.get('/tasks/{task_id}')
    async def task(task_id: str, request: Request):
        if relay is not None:
            return await relay(request)
        try:
            service, owner = context(request)
            return {'task': await anyio.to_thread.run_sync(service.get_task, owner, task_id)}
        except AnalysisError as exc:
            return failure(exc)

    @router.post('/tasks/{task_id}/cancel')
    async def cancel(task_id: str, request: Request):
        if relay is not None:
            return await relay(request)
        try:
            service, owner = context(request)
            await read_body(request, 65536)
            return {'task': await anyio.to_thread.run_sync(service.cancel, owner, task_id)}
        except AnalysisError as exc:
            return failure(exc)

    @router.get('/artifacts/{artifact_id}')
    async def artifact(artifact_id: str, request: Request):
        if relay is not None:
            return await relay(request)
        try:
            service, owner = context(request)
            path, item = await anyio.to_thread.run_sync(service.artifact, owner, artifact_id)
            # Safe raster images may be previewed; documents/code download as attachments.
            inline = item['mime'].startswith('image/')
            return FileResponse(path, media_type=item['mime'], filename=item['name'],
                                content_disposition_type='inline' if inline else 'attachment',
                                headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                                         'Content-Security-Policy': "default-src 'none'; sandbox"})
        except AnalysisError as exc:
            return failure(exc)
    return router


def _check_remote_excel(raw):
    """Bound expanded content before opening a remote workbook with openpyxl."""
    try:
        with ZipFile(io.BytesIO(raw)) as archive:
            members = archive.infolist()
            if len(members) > 2048 or sum(item.file_size for item in members) > 128 * 1024**2:
                raise AnalysisError('workbook_too_large', 'Excel 解压后内容过大，请缩小数据范围或另存为 CSV。', 413)
    except BadZipFile as exc:
        raise AnalysisError('invalid_excel', '无法解析该 Excel 文件，请另存为 .xlsx 后重试。') from exc
