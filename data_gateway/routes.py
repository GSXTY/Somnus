"""Data routes shared by the gateway and desktop relay."""
import re


HEALTH_PATH = '/api/data-gateway/health'
PRESENCE_PATH = '/api/data-gateway/presence'
CLIENT_VERSION = re.compile(r'\d{1,4}\.\d{1,4}\.\d{1,4}(?:[-+][A-Za-z0-9.-]{1,32})?\Z')
DATA_ROUTES = {
    '/api/workbench': 'GET',
    '/api/sql/schema': 'GET',
    '/api/sql/query': 'POST',
    '/api/sql/ask': 'POST',
    '/api/sql/propose': 'POST',
}
USER_PATH = re.compile(r'/api/workbench/users/[A-Za-z0-9_-]{1,128}\Z')
TOKEN = re.compile(r'[A-Za-z0-9_-]{32,256}\Z')
MAX_REQUEST_BYTES = 65536
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
DEEP_PREFIX = '/api/deep-analysis'
DEEP_FILE = DEEP_PREFIX + '/files'
DEEP_STATUS = DEEP_PREFIX + '/status'
DEEP_SAMPLE = DEEP_PREFIX + '/sample.csv'
DEEP_TASKS = DEEP_PREFIX + '/tasks'
DEEP_UPLOAD_BYTES = 20 * 1024 * 1024
DEEP_ARTIFACT_BYTES = 10 * 1024 * 1024
DEEP_UPLOAD_TYPES = frozenset({
    'text/csv', 'application/octet-stream', 'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
})
DEEP_RASTER_TYPES = frozenset({'image/png', 'image/jpeg', 'image/webp'})
DEEP_ARTIFACT_TYPES = DEEP_RASTER_TYPES | {
    'text/markdown', 'text/plain', 'text/csv', 'application/pdf', 'text/x-python',
}
DEEP_ARTIFACT_PATH = re.compile(DEEP_PREFIX + r'/artifacts/[a-f0-9]{32}\Z')
DEEP_TASK_PATH = re.compile(DEEP_TASKS + r'/[a-f0-9]{32}(/cancel)?\Z')


def deep_method_allowed(path, method):
    if path in (DEEP_STATUS, DEEP_SAMPLE) or DEEP_ARTIFACT_PATH.fullmatch(path):
        return method == 'GET'
    if path == DEEP_FILE:
        return method == 'POST'
    if path == DEEP_TASKS:
        return method in ('GET', 'POST')
    if DEEP_TASK_PATH.fullmatch(path):
        return method == ('POST' if path.endswith('/cancel') else 'GET')
    return False


def method_for(path):
    return DATA_ROUTES.get(path) or ('GET' if USER_PATH.fullmatch(path) else None)
