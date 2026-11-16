"""把新的数据库密码写进 .env（自动做 URL 转义），避免手改出错。

用法：
    python tools/set_db_password.py            # 交互输入，不留在命令历史
    python tools/set_db_password.py 新密码

只改 ANALYTICS_DB_URL 一行，其余配置原样保留。
"""
from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / '.env'
KEY = 'ANALYTICS_DB_URL'


def main():
    password = sys.argv[1] if len(sys.argv) > 1 else ''
    if not password:
        import getpass
        password = getpass.getpass('请输入新的数据库密码（输入不显示）：')
    password = password.strip()
    if not password:
        print('❌ 密码为空，未修改。')
        return 2

    if not ENV.is_file():
        print(f'❌ 找不到 {ENV}')
        return 2

    lines = ENV.read_text(encoding='utf-8').splitlines()
    for index, line in enumerate(lines):
        if not line.strip().startswith(KEY + '='):
            continue
        url = line.split('=', 1)[1].strip()
        parts = urlsplit(url)
        if parts.scheme not in ('mysql', 'mysql+pymysql'):
            print(f'❌ 当前 {KEY} 不是 MySQL 连接串：{url[:40]}…')
            return 2
        user = parts.username or ''
        host = parts.hostname or ''
        port = parts.port or 3306
        database = (parts.path or '').lstrip('/')
        rebuilt = urlunsplit((
            'mysql',
            f'{quote(user, safe="")}:{quote(password, safe="")}@{host}:{port}',
            '/' + database,
            parts.query,
            parts.fragment,
        ))
        lines[index] = f'{KEY}={rebuilt}'
        ENV.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        print('✅ 已更新密码：')
        print(f'   账号：{user}')
        print(f'   主机：{host}:{port}')
        print(f'   库名：{database or "（未指定）"}')
        print(f'   密码：{"*" * len(password)}（{len(password)} 位，已转义特殊字符）')
        print('\n下一步：python tools/check_db.py')
        return 0

    print(f'❌ .env 里没有 {KEY} 这一行')
    return 2


if __name__ == '__main__':
    sys.exit(main())
