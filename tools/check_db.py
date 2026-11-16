"""一键诊断数据库连接：逐层检查配置、DNS、端口、账号、库表。

用法：
    python tools/check_db.py                 # 读取 .env 里的 ANALYTICS_DB_URL
    python tools/check_db.py --host ... --user ... --password ... --database ...

只读操作：只会执行 SELECT / SHOW，不会修改任何数据。
"""
from __future__ import annotations

import argparse
import os
import socket
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent.parent

OK = '✅'
BAD = '❌'
WARN = '⚠️ '


def load_env(path=ROOT / '.env'):
    values = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def parse_url(url):
    parts = urlsplit(url)
    return dict(
        scheme=parts.scheme,
        host=parts.hostname or '',
        port=parts.port or 3306,
        user=unquote(parts.username or ''),
        password=unquote(parts.password or ''),
        database=(parts.path or '').lstrip('/'),
    )


def fail(message, hint=''):
    print(f'{BAD} {message}')
    if hint:
        print(f'   → {hint}')
    return False


def main():
    parser = argparse.ArgumentParser(description='诊断 ANALYTICS_DB_URL 是否可用')
    parser.add_argument('--host')
    parser.add_argument('--port', type=int)
    parser.add_argument('--user')
    parser.add_argument('--password')
    parser.add_argument('--ask-password', action='store_true', help='运行后交互式输入密码，不留在命令历史里')
    parser.add_argument('--database')
    parser.add_argument('--url', help='直接传入完整连接串')
    args = parser.parse_args()
    if args.ask_password and not args.password:
        import getpass
        args.password = getpass.getpass('请输入数据库密码（输入时不显示）：')

    env = load_env()
    url = args.url or env.get('ANALYTICS_DB_URL', '')
    if not url and args.host and args.user and args.password:
        database = args.database or ''
        url = f"mysql://{args.user}:{args.password}@{args.host}:{args.port or 3306}/{database}"
    if not url:
        print(f'{BAD} 没有找到 ANALYTICS_DB_URL')
        print('   请在 .env 里配置，例如：')
        print('   ANALYTICS_DB_URL=mysql://user:password@host:3306/dbname')
        print('   或直接传参：')
        print('   python tools/check_db.py --host 主机 --user 账号 --password 密码 --database 库名')
        return 2

    config = parse_url(url) if url.startswith(('mysql://', 'mysql+pymysql://', 'sqlite')) else {}
    if url.startswith('sqlite'):
        print(f'{OK} 当前是 SQLite：{url}')
        print('   这是演示库，不是真实 MySQL。要连真实库请把 ANALYTICS_DB_URL 改成 mysql://...')
        return 0
    for key in ('host', 'port', 'user', 'password', 'database'):
        override = getattr(args, key)
        if override:
            config[key] = override

    print('一、配置')
    print(f'   主机：{config["host"]}:{config["port"]}')
    print(f'   账号：{config["user"]}')
    print(f'   密码：{config["password"]}')
    print(f'   库名：{config["database"] or "（未指定）"}')
    if not config['host'] or not config['user'] or not config['password']:
        return 1 if fail('配置不完整', '检查 ANALYTICS_DB_URL 的格式：mysql://用户:密码@主机:端口/库名') else 1

    print('\n二、域名解析')
    try:
        address = socket.gethostbyname(config['host'])
        print(f'{OK} {config["host"]} → {address}')
    except OSError as exc:
        fail(f'解析失败：{exc}', '地址写错了，或者这台机器 DNS 不可用；可在控制台复制连接地址核对')
        return 1

    print('\n三、端口连通')
    try:
        with socket.create_connection((address, config['port']), timeout=8):
            print(f'{OK} {address}:{config["port"]} 可连接')
    except OSError as exc:
        fail(f'连不上：{type(exc).__name__}', '多半是 RDS 白名单没有放行你的出口 IP（超时）；或端口写错')
        return 1

    print('\n四、账号认证')
    try:
        import pymysql
    except ImportError:
        fail('缺少 pymysql', '执行：pip install pymysql cryptography')
        return 1

    try:
        connection = pymysql.connect(
            host=config['host'], port=config['port'], user=config['user'],
            password=config['password'], database=config['database'] or None,
            connect_timeout=10, read_timeout=20,
        )
    except pymysql.err.OperationalError as exc:
        code, message = exc.args[0], exc.args[1]
        if code == 1045:
            fail('账号或密码被拒绝（1045）', '密码不对，或账号不允许从这个 IP 登录；请让对方重置密码后再试')
        elif code == 1049:
            fail(f'库不存在（1049）：{config["database"]}', '库名写错，或该账号没有授权这个库')
        elif code == 1044:
            fail(f'没有该库权限（1044）：{config["database"]}', '账号存在但没授权这个库，请让对方授权')
        else:
            fail(f'连接失败（{code}）：{message}', '把这段报错发给 DBA')
        return 1
    except Exception as exc:
        fail(f'连接异常：{type(exc).__name__}：{exc}')
        return 1

    print(f'{OK} 登录成功')
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT VERSION(), CURRENT_USER(), DATABASE()')
            version, current_user, current_db = cursor.fetchone()
            print(f'   MySQL：{version}')
            print(f'   身份：{current_user}')
            print(f'   当前库：{current_db}')

            print('\n五、可访问的库')
            try:
                cursor.execute('SHOW DATABASES')
                names = [row[0] for row in cursor.fetchall()]
                print('   ' + '、'.join(names) if names else '   （空）')
            except Exception as exc:
                print(f'   {WARN}无法列出库：{exc}')

            if config['database']:
                print(f'\n六、库 {config["database"]} 里的表（行数为统计值，不扫描大表）')
                try:
                    cursor.execute(
                        'SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES '
                        'WHERE TABLE_SCHEMA=%s ORDER BY TABLE_NAME', (config['database'],))
                    rows = cursor.fetchall()
                except Exception as exc:
                    rows = []
                    print(f'   {WARN}读取表清单失败：{type(exc).__name__}')
                if not rows:
                    print(f'   {WARN}这个库里没有表（或账号看不到）')
                for name, estimate in rows[:80]:
                    size = f'{int(estimate):,} 行' if estimate is not None else '行数未知'
                    print(f'   {name}: ≈{size}')
                if len(rows) > 80:
                    print(f'   …还有 {len(rows) - 80} 张表')

            print('\n七、只读检查')
            try:
                cursor.execute('SELECT 1')
                cursor.fetchone()
                print(f'{OK} 可以执行 SELECT')
            except Exception as exc:
                print(f'{BAD} SELECT 失败：{exc}')
    finally:
        connection.close()

    print('\n完成。若以上全部通过，把 .env 的 ANALYTICS_DB_URL 保留这一条即可，')
    print('再设置 ANALYTICS_SQL_TABLES 限定允许查询的表名。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
