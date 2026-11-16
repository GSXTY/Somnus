"""Local and server launch options for the unified FastAPI host."""
import argparse
import ipaddress
import os
import re
import sys
import threading
import webbrowser
from pathlib import Path

from app_version import APP_VERSION
from server.paths import ROOT, default_data_dir, prepare_default_data_dir, profile_env_dir


def load_env(path=None, *, data_dir=None):
    """Load KEY=VALUE pairs from .env without overriding real environment variables.

    The first existing candidate wins. Values are kept as-is after trimming an
    optional matching quote pair; no interpolation or command substitution.
    """
    if path:
        candidates = [Path(path)]
    elif getattr(sys, 'frozen', False) and sys.platform == 'darwin':
        # Finder can start with an unrelated working directory or translocate the bundle.
        candidates = [default_data_dir() / '.env']
    else:
        candidates = []
        if getattr(sys, 'frozen', False):
            # Packaged desktop build: the operator drops .env next to the exe.
            candidates.append(Path(sys.executable).resolve().parent / '.env')
            if sys.platform == 'win32':
                candidates.append((data_dir or profile_env_dir()) / '.env')
        candidates.extend([Path.cwd() / '.env', ROOT / '.env'])
    for candidate in candidates:
        try:
            if not candidate.is_file():
                continue
            text = candidate.read_text(encoding='utf-8-sig')
        except OSError:
            continue
        for line in text.splitlines():
            entry = line.strip()
            if not entry or entry.startswith('#') or '=' not in entry:
                continue
            key, _, value = entry.partition('=')
            key = key.strip()
            if key.startswith('export '):
                key = key[len('export '):].strip()
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key):
                continue
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '"\'':
                value = value[1:-1]
            os.environ.setdefault(key, value)
        return candidate
    return None


def parser():
    options = argparse.ArgumentParser(description='启动 Somnus 工作台（当前仅支持单 worker）。')
    options.add_argument('file', nargs='?', default=None)
    options.add_argument('--host', default='127.0.0.1')
    options.add_argument('--port', type=int, default=8765,
                         help='监听端口；桌面外壳可配合 --ready-file 使用 0 自动分配。')
    options.add_argument('--no-browser', action='store_true',
                         help='不自动打开界面；配合 --window 时仅打开桌面窗口。')
    options.add_argument('--window', dest='window', action='store_true', default=None,
                         help='在独立桌面窗口中打开界面（需要 pywebview）。')
    options.add_argument('--no-window', dest='window', action='store_false',
                         help='始终在本机浏览器中打开界面。')
    options.add_argument('--data-dir', type=Path)
    options.add_argument('--ready-file', type=Path, help=argparse.SUPPRESS)
    options.add_argument('--shutdown-on-stdin-close', action='store_true', help=argparse.SUPPRESS)
    options.add_argument('--session-mode', choices=['shared', 'isolated'], default=None,
                         help='本机默认 shared 保留旧 MCP 兼容；服务器请用 isolated。')
    options.add_argument('--version', action='version', version=APP_VERSION)
    return options


def desktop_available():
    """True when a native desktop window can be attempted (pywebview installed)."""
    try:
        import webview  # noqa: F401
    except Exception:
        return False
    return True


def run_windowed(app, host, port, url, title='Somnus', *, browser_fallback=True):
    """Serve in a background thread while the native GUI runs on the main thread.

    Browser fallback is available when the native window cannot be created.
    """
    import time
    import uvicorn
    import webview

    config = uvicorn.Config(app, host=host, port=port, workers=1, access_log=False, log_level='warning',
                            proxy_headers=False)
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name='uvicorn', daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 30
        while not server.started and thread.is_alive() and time.monotonic() < deadline:
            time.sleep(0.05)
        if not server.started:
            print('Cannot start workspace: service did not become ready.', flush=True)
            return 1
        try:
            if sys.platform == 'darwin':
                webview.create_window(title, url, width=1280, height=820, min_size=(900, 600))
                webview.start(gui='cocoa', private_mode=False)
            else:
                webview.create_window(title, url, width=1360, height=900, min_size=(1024, 680))
                webview.start()
        except Exception as exc:
            print(f'Desktop window unavailable ({exc}).', flush=True)
            if not browser_fallback or not webbrowser.open(url):
                return 1
            while thread.is_alive():
                time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    return 0


def _redirect_output_when_headless(data_dir=None):
    """Send output to a log file when started without a console (windowed build)."""
    if sys.stdout is not None and sys.stderr is not None:
        return None
    try:
        folder = (data_dir or default_data_dir()) / 'logs'
        folder.mkdir(parents=True, exist_ok=True)
        stream = open(folder / 'app.log', 'a', encoding='utf-8', buffering=1)
    except Exception:
        return None
    sys.stdout = stream
    sys.stderr = stream
    return stream


def pick_port(host, port, attempts=20):
    """Return the first free port at or above ``port``; never silently exceeds range."""
    import socket
    bind_host = '127.0.0.1' if host in ('0.0.0.0', '::') else host
    for offset in range(attempts):
        candidate = port + offset
        if candidate > 65535:
            break
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind((bind_host, candidate))
            except OSError:
                continue
            return candidate
    return port


def main(argv=None):
    options = parser()
    args = options.parse_args(argv)
    if args.ready_file and (not args.ready_file.is_absolute() or args.host != '127.0.0.1' or args.window):
        options.error('--ready-file 需要绝对路径和本机监听，不能与 --window 一起使用。')
    if args.shutdown_on_stdin_close and not args.ready_file:
        options.error('--shutdown-on-stdin-close 需要同时指定 --ready-file。')
    if not (0 if args.ready_file else 1) <= args.port <= 65535:
        options.error('端口必须在 1 至 65535 之间；桌面外壳可配合 --ready-file 使用 0。')
    data_dir = args.data_dir.expanduser().resolve() if args.data_dir else None
    profile_before = profile_env_dir()
    loaded = load_env(data_dir=data_dir)
    if data_dir is None:
        try:
            data_dir = prepare_default_data_dir()
        except OSError:
            options.error('无法迁移 Somnus 本机配置。旧版目录仍然保留，请关闭其他 Somnus 实例后重试。')
        if (loaded == profile_before / '.env' and profile_before != data_dir
                and data_dir == profile_before.with_name('Somnus')):
            loaded = data_dir / '.env'
    remote_ca = os.getenv('DATA_AGENT_REMOTE_CA', '').strip()
    if loaded and remote_ca:
        ca_path = Path(remote_ca).expanduser()
        if not ca_path.is_absolute():
            os.environ['DATA_AGENT_REMOTE_CA'] = str(loaded.resolve().parent / ca_path)
    _redirect_output_when_headless(data_dir)
    if loaded:
        print(f'Loaded environment from {loaded}', flush=True)
    if args.file and not Path(args.file).is_file():
        parser().error('指定的 CSV 文件不存在。')
    from server.app import create_app
    import uvicorn
    try:
        loopback = args.host == 'localhost' or ipaddress.ip_address(args.host).is_loopback
    except ValueError:
        loopback = False
    mode = args.session_mode or os.getenv('AI_AGENT_SESSION_MODE') or ('shared' if loopback else 'isolated')
    if mode == 'shared' and not loopback:
        parser().error('shared 共享模式仅允许监听本机地址；服务器请使用 isolated。')
    app = create_app(data_dir=data_dir, initial_file=args.file, session_mode=mode, mcp_management=loopback,
                     managed_desktop=bool(args.ready_file and args.shutdown_on_stdin_close))
    if args.ready_file:
        from server.desktop import run_managed_desktop

        try:
            return run_managed_desktop(app, args.port, args.ready_file, args.shutdown_on_stdin_close)
        except OSError as exc:
            print(f'Cannot start workspace: {exc}', flush=True)
            return 1
    port = pick_port(args.host, args.port)
    if port != args.port:
        print(f'端口 {args.port} 已被占用，改用 {port}。', flush=True)
    display_host = '127.0.0.1' if args.host in ('0.0.0.0', '::') else args.host
    url = f'http://{display_host}:{port}'
    print(f'Somnus workspace: {url}', flush=True)
    if args.host not in ('127.0.0.1', 'localhost', '::1'):
        print('Listening beyond loopback: use a trusted reverse proxy with authentication; this release has no account isolation.', flush=True)
    wants_window = args.window if args.window is not None else bool(getattr(sys, 'frozen', False) and not args.no_browser)
    if wants_window and desktop_available():
        return run_windowed(app, args.host, port, url, browser_fallback=not args.no_browser)
    if wants_window and args.no_browser:
        print('Desktop window unavailable (pywebview could not be loaded).', flush=True)
        return 1
    if not args.no_browser:
        browser = threading.Timer(1, webbrowser.open, args=(url,))
        browser.daemon = True
        browser.start()
    try:
        uvicorn.run(app, host=args.host, port=port, workers=1, access_log=False, proxy_headers=False)
    except OSError as exc:
        print(f'Cannot start workspace: {exc}', flush=True)
        return 1
    return 0
