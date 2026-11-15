"""A bounded code executor. No generated code is ever executed on the host."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import uuid


class ExecutionError(Exception):
    pass


class DockerExecutor:
    def __init__(self, config):
        self.config = config
        self.cached = None
        self.cached_at = 0
        self.lock = threading.RLock()
        self.processes = {}

    @staticmethod
    def workspace_over_budget(workspace):
        total, count, directories = 0, 0, [Path(workspace)]
        while directories:
            current = directories.pop()
            try:
                for path in current.iterdir():
                    count += 1
                    if count > 500:
                        return True
                    if path.is_symlink():
                        continue
                    if path.is_dir():
                        directories.append(path)
                    elif path.is_file():
                        total += path.stat().st_size
                        if total > 50 * 1024**2:
                            return True
            except OSError:
                return True
        return False

    @staticmethod
    def _remove(executable, name):
        try:
            subprocess.run([executable, 'rm', '-f', name], capture_output=True, timeout=8,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except (OSError, subprocess.SubprocessError):
            pass

    def close(self):
        with self.lock:
            active = list(self.processes.items())
        for name, (executable, process) in active:
            if process.poll() is None:
                try:
                    process.kill()
                except OSError:
                    pass
            self._remove(executable, name)

    def readiness(self, force=False):
        if not force and self.cached is not None and time.monotonic() - self.cached_at < 15:
            return self.cached.copy()
        executable = shutil.which('docker')
        available, image_ready = False, False
        reason = '未找到 Docker。请安装并启动 Docker 后重试；不会在宿主机执行生成代码。'
        if executable:
            try:
                probe = subprocess.run([executable, 'info', '--format', '{{.OSType}}'], capture_output=True, timeout=8,
                                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                available = probe.returncode == 0 and probe.stdout.strip() == b'linux'
                reason = 'Docker 未就绪或未切换为 Linux 容器。'
                if available:
                    inspected = subprocess.run([executable, 'image', 'inspect', self.config.image], capture_output=True, timeout=8,
                                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    image_ready = inspected.returncode == 0
                    reason = '' if image_ready else '执行镜像不存在，请按说明手动构建；服务不会自动拉取镜像。'
            except (OSError, subprocess.SubprocessError):
                reason = '无法确认 Docker 状态，请检查 Docker 服务。'
        self.cached = dict(docker_available=available, image_ready=image_ready, execution_ready=available and image_ready,
                           execution_reason=reason)
        self.cached_at = time.monotonic()
        return self.cached.copy()

    def execute(self, code, input_path, workspace, cancel, deadline):
        if cancel.is_set():
            raise ExecutionError('cancelled')
        if not self.readiness()['execution_ready']:
            raise ExecutionError('执行环境尚未就绪。')
        workspace = Path(workspace).resolve()
        # Workspace is the only writable bind mount. Source uploads and metadata are outside it.
        workspace.mkdir(parents=True, exist_ok=True)
        if os.name != 'nt':
            workspace.chmod(0o777)
        script = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', suffix='.py',
                                             dir=workspace.parent, delete=False) as handle:
                script = Path(handle.name)
                handle.write(code)
            if os.name != 'nt':
                script.chmod(0o644)
            return self._execute(script, input_path, workspace, cancel, deadline)
        finally:
            if script is not None:
                script.unlink(missing_ok=True)

    def _execute(self, script, input_path, workspace, cancel, deadline):
        name = 'ya70-analysis-' + uuid.uuid4().hex
        executable = shutil.which('docker')
        command = [executable, 'run', '--rm', '--pull=never', '--name', name, '--network', 'none', '--read-only',
                   '--user', '65534:65534', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                   '--pids-limit', '64', '--memory', '512m', '--memory-swap', '512m', '--cpus', '1',
                   '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
                   '--mount', f'type=bind,src={Path(input_path).resolve()},dst=/input/data.csv,readonly',
                   '--mount', f'type=bind,src={script},dst=/input/analysis.py,readonly',
                   '--mount', f'type=bind,src={workspace},dst=/work', '--workdir', '/work',
                   '--env', 'MPLCONFIGDIR=/tmp/matplotlib', '--env', 'PYTHONDONTWRITEBYTECODE=1',
                   self.config.image, 'python', '-I', '/input/analysis.py']
        log = workspace.parent / ('execution-' + uuid.uuid4().hex + '.log')
        started = time.monotonic()
        process = None
        try:
            with log.open('wb') as output:
                with self.lock:
                    if cancel.is_set():
                        raise ExecutionError('cancelled')
                    process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT,
                                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    self.processes[name] = executable, process
                while process.poll() is None:
                    if cancel.is_set():
                        raise ExecutionError('cancelled')
                    if time.monotonic() >= deadline or time.monotonic() - started >= self.config.code_timeout:
                        raise ExecutionError('代码执行超时，已停止容器。')
                    if log.stat().st_size > self.config.max_output_bytes:
                        raise ExecutionError('代码输出超出限制，已停止容器。')
                    if self.workspace_over_budget(workspace):
                        raise ExecutionError('工作区文件数量或大小超出限制，已停止容器。')
                    time.sleep(.15)
            if self.workspace_over_budget(workspace) or log.stat().st_size > self.config.max_output_bytes:
                raise ExecutionError('执行输出超过工作区限制。')
            with log.open('rb') as result:
                content = result.read(20000).decode('utf-8', errors='replace')
            return dict(exit_code=process.returncode, output=content)
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait(timeout=5)
            if executable:
                self._remove(executable, name)
            with self.lock:
                self.processes.pop(name, None)
            log.unlink(missing_ok=True)
