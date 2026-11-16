"""Prepare explicit release changes in the private standard checkout."""

import ast
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


SOURCE_URL = 'https://github.com/GSXTY/Somnus.git'
SOURCE_API = 'https://api.github.com/repos/GSXTY/Somnus'
RELEASE_API = 'https://api.github.com/repos/GSXTY/Somnus-Releases'
WORKFLOW = '.github/workflows/publish.yml'
POLICY = 'skills/defaults.json'
VERSION_FILES = ('app_version.py', 'electron/package.json', POLICY)
REQUIRED_SECRETS = {'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'SOMNUS_RELEASES_TOKEN'}
VERSION = re.compile(r'(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})(?:-beta\.([1-9][0-9]{0,5}))?')


class AdminError(ValueError):
    pass


def version_key(version):
    if not isinstance(version, str) or not (parts := VERSION.fullmatch(version)):
        raise AdminError('输入有效的版本号，例如 0.3.0-beta.6 或 0.3.0。')
    major, minor, patch, beta = parts.groups()
    return int(major), int(minor), int(patch), beta is None, int(beta or 0)


@dataclass(frozen=True)
class Draft:
    version: str
    handoff: bool
    notes: str
    signed: bool

    @classmethod
    def parse(cls, value):
        if not isinstance(value, dict) or set(value) != {'version', 'handoff', 'notes', 'signed'}:
            raise AdminError('发布草稿字段不完整。')
        version_key(value['version'])
        if (type(value['handoff']) is not bool or type(value['signed']) is not bool
                or not isinstance(value['notes'], str) or len(value['notes']) > 3000):
            raise AdminError('发布说明过长或插件状态无效。')
        if not value['signed'] and '-beta.' not in value['version']:
            raise AdminError('正式版本需要 Windows 安装包签名。')
        return cls(value['version'], value['handoff'], value['notes'].strip(), value['signed'])


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class StandardRelease:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.environment = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'never'}
        self.opener = build_opener(NoRedirect())

    def git(self, *args, input=None, timeout=30):
        try:
            result = subprocess.run(
                ['git', '-C', str(self.root), *args], input=input, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True, encoding='utf-8', errors='replace',
                timeout=timeout, env=self.environment, check=True)
        except (OSError, subprocess.SubprocessError) as exc:
            raise AdminError('Git 操作没有完成，请检查标准版工作区和 GitHub 登录状态。') from exc
        return result.stdout.strip()

    def _api(self, url, data=None):
        credential = self.git('credential', 'fill', input='protocol=https\nhost=github.com\n\n')
        token = next((line.removeprefix('password=') for line in credential.splitlines()
                      if line.startswith('password=')), None)
        if not token:
            raise AdminError('本机 Git 没有可用的 GitHub 凭据。')
        request = Request(url, data=None if data is None else json.dumps(data).encode('utf-8'), headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
        })
        try:
            with self.opener.open(request, timeout=20) as response:
                return json.load(response) if response.status != 204 else {}
        except HTTPError as exc:
            with exc:
                if exc.code == 404:
                    return None
                raise AdminError(f'GitHub 请求未完成（HTTP {exc.code}）。') from exc
        except (URLError, OSError, ValueError) as exc:
            raise AdminError('无法访问 GitHub API。') from exc

    def state(self):
        versions = (self.root / 'app_version.py').read_text(encoding='utf-8')
        match = re.search(r'^APP_VERSION = ((?:\x27[^\x27]*\x27)|(?:"[^"]*"))$', versions, re.MULTILINE)
        version = ast.literal_eval(match[1]) if match else ''
        version_key(version)
        package_version = json.loads((self.root / 'electron/package.json').read_text(encoding='utf-8'))['version']
        if package_version != version:
            raise AdminError('标准版的 Python 和 Electron 版本号不一致。')
        policy_file = self.root / POLICY
        handoff = json.loads(policy_file.read_text(encoding='utf-8'))['project_handoff'] if policy_file.exists() else True
        if type(handoff) is not bool:
            raise AdminError('标准版默认插件清单无效。')
        return {'version': version, 'handoff': handoff, 'workflow': (self.root / WORKFLOW).is_file(),
                'dirty': bool(self.git('status', '--porcelain'))}

    def submit(self, draft):
        state = self.state()
        if state['dirty'] or self.git('branch', '--show-current') != 'main':
            raise AdminError('请在标准版 main 分支处理工作区中的改动，再提交发布。')
        if self.git('remote', 'get-url', 'origin').removesuffix('/') != SOURCE_URL:
            raise AdminError('标准版仓库的 origin 必须是私有仓库 GSXTY/Somnus。')
        if not state['workflow']:
            raise AdminError('标准版的自动发布工作流尚未安装。')
        if not draft.notes:
            raise AdminError('请填写本次发布的说明。')
        if version_key(draft.version) < version_key(state['version']):
            raise AdminError('发布版本不能低于标准版当前版本。')
        if self._api(f'{RELEASE_API}/releases/tags/v{draft.version}') is not None:
            raise AdminError('此版本已经存在于 GitHub 发布仓库。')
        secrets = self._api(f'{SOURCE_API}/actions/secrets?per_page=100')
        configured = {item['name'] for item in (secrets or {}).get('secrets', [])}
        missing = (REQUIRED_SECRETS if draft.signed else {'SOMNUS_RELEASES_TOKEN'}) - configured
        if missing:
            raise AdminError('GitHub Actions 缺少发布配置：' + '、'.join(sorted(missing)))

        if state['version'] != draft.version or state['handoff'] != draft.handoff:
            self._commit(draft)
        self.git('push', 'origin', 'HEAD:main', timeout=90)
        result = self._api(f'{SOURCE_API}/actions/workflows/publish.yml/dispatches',
                           {'ref': 'main', 'inputs': {'version': draft.version, 'notes': draft.notes,
                                                       'signed': str(draft.signed).lower()}})
        if result is None:
            raise AdminError('源码已推送，GitHub 未找到发布工作流。')
        return {'version': draft.version, 'action_url': 'https://github.com/GSXTY/Somnus/actions/workflows/publish.yml'}

    def _commit(self, draft):
        python, electron, policy = (self.root / path for path in VERSION_FILES)
        version_line = re.compile(r'^APP_VERSION = .*$', re.MULTILINE)
        python_text, replacements = version_line.subn(
            f"APP_VERSION = '{draft.version}'", python.read_text(encoding='utf-8'))
        electron_text = electron.read_text(encoding='utf-8')
        electron_text, package_replacements = re.subn(r'(?m)^(  "version": )"[^"]+"(,?)$',
                                                     rf'\g<1>"{draft.version}"\2', electron_text)
        if replacements != 1 or package_replacements != 1:
            raise AdminError('版本文件格式不符合预期。')
        python.write_text(python_text, encoding='utf-8')
        electron.write_text(electron_text, encoding='utf-8')
        policy.write_text(json.dumps({'project_handoff': draft.handoff}, indent=2) + '\n', encoding='utf-8')
        self.git('add', '--', *VERSION_FILES)
        self.git('diff', '--cached', '--check')
        self.git('-c', 'user.name=GSXTY', '-c', 'user.email=59636093+GSXTY@users.noreply.github.com',
                 'commit', '-m', f'Prepare Somnus {draft.version}')
