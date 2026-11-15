"""Desktop capability for project-folder selection and file approval."""
import hmac
import ipaddress
import os
import re
import secrets
import sys
import threading
import time
from urllib.parse import urlsplit

from .project_files import ProjectFileError, validate_root


class DesktopAccess:
    def __init__(self):
        token = os.environ.pop('RESPIRATORY_VIEWER_PROJECT_TOKEN', '')
        self.native = token if sys.platform == 'win32' and re.fullmatch('[0-9a-f]{64}', token) else ''
        self.browser = hmac.digest(self.native.encode(), b'vvman-project-browser-session', 'sha256').hex()
        self.grants = {}
        self.lock = threading.Lock()

    @staticmethod
    def _loopback(host):
        try:
            return bool(host) and (host == 'localhost' or ipaddress.ip_address(host).is_loopback)
        except ValueError:
            return False

    def local(self, request):
        if (not self.native or os.getenv('SHARE_MODE', '').strip() == '1'
                or getattr(request.app.state, 'session_mode', '') != 'shared'
                or not request.client or not self._loopback(request.client.host)):
            return False
        if any(request.headers.get(name) for name in ('forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto')):
            return False
        try:
            hosts = request.headers.getlist('host')
            if len(hosts) != 1:
                return False
            host = urlsplit('http://' + hosts[0])
            if not self._loopback(host.hostname) or host.username or host.password or host.path or host.query or host.fragment:
                return False
            origins = request.headers.getlist('origin')
            if origins != [] and origins != [f'{request.url.scheme}://{host.netloc}']:
                return False
        except ValueError:
            return False
        if request.headers.get('sec-fetch-site') in ('same-site', 'cross-site'):
            return False
        return True

    def allowed(self, request, *, native=False):
        if not self.local(request):
            return False
        native_values = request.headers.getlist('x-data-agent-native')
        native_allowed = len(native_values) == 1 and hmac.compare_digest(native_values[0].encode(), self.native.encode())
        if native:
            return native_allowed
        if request.method not in ('GET', 'HEAD') and not request.headers.getlist('origin') and request.headers.get('x-data-agent-local') != '1':
            return False
        cookie = request.cookies.get('respiratory_desktop', '')
        return native_allowed or hmac.compare_digest(cookie.encode(), self.browser.encode())

    def grant(self, path):
        root, identity = validate_root(path)
        token = secrets.token_urlsafe(32)
        now = time.monotonic()
        with self.lock:
            self.grants = {key: value for key, value in self.grants.items() if value[2] > now}
            if len(self.grants) >= 64:
                raise ProjectFileError('所选目录过多，请稍后重试。', code='folder_grant_limit', status=429)
            self.grants[token] = (root, identity, now + 600)
        return dict(root_path=root, folder_grant=token)

    def consume(self, path, token):
        return self.consume_many([(path, token)])[0][0]

    def consume_many(self, selections):
        checked = []
        for path, token in selections:
            if not isinstance(token, str) or len(token) > 100:
                raise ProjectFileError('请通过桌面目录选择器选择项目目录。', code='folder_grant_required', status=403)
            checked.append((token, validate_root(path)))
        if len({token for token, _ in checked}) != len(checked):
            raise ProjectFileError('目录授权只能使用一次。', code='folder_grant_required', status=403)
        with self.lock:
            now = time.monotonic()
            for token, binding in checked:
                grant = self.grants.get(token)
                if not grant or grant[:2] != binding or grant[2] <= now:
                    raise ProjectFileError('目录授权已失效，请重新选择项目目录。', code='folder_grant_required', status=403)
            for token, _ in checked:
                del self.grants[token]
        return [binding for _, binding in checked]
