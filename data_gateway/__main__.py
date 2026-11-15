"""Start the independently configured HTTPS data gateway."""
import argparse
import json
import os
from pathlib import Path
import re
import ssl
import sqlite3
import sys

import uvicorn

from agent_core.sql_access import SqlSettings
from data_gateway.app import create_gateway
from server.cli import load_env


TABLE_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*\Z')


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='启动Somnus 局域网 HTTPS 数据网关。')
    parser.add_argument('--config', required=True, type=Path)
    args = parser.parse_args(argv)
    config_path = args.config.expanduser().resolve()
    if not load_env(config_path):
        parser.error('无法读取网关配置文件。')
    if not os.getenv('ANALYTICS_DB_URL', '').strip():
        parser.error('网关需要明确配置 ANALYTICS_DB_URL。')

    def config_file(name):
        value = os.getenv(name, '').strip()
        if not value:
            parser.error(f'请配置 {name}。')
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = config_path.parent / path
        if not path.is_file():
            parser.error(f'{name} 对应文件不存在。')
        return path

    tokens = tuple(item.strip() for item in os.getenv('DATA_AGENT_GATEWAY_TOKENS', '').split(',') if item.strip())
    tables = tuple(item.strip().lower() for item in os.getenv('DATA_AGENT_GATEWAY_SQL_TABLES', '').split(',') if item.strip())
    sql_flag = os.getenv('DATA_AGENT_GATEWAY_SQL_ENABLED', '0').strip()
    if sql_flag not in ('0', '1') or any(not TABLE_NAME.fullmatch(table) for table in tables):
        parser.error('远程 SQL 配置无效。')
    deep_flag = os.getenv('DATA_AGENT_GATEWAY_DEEP_ENABLED', '0').strip()
    deep_tokens = tuple(item.strip() for item in os.getenv('DATA_AGENT_GATEWAY_DEEP_TOKENS', '').split(',') if item.strip())
    if deep_flag not in ('0', '1'):
        parser.error('远程深度分析配置无效。')
    try:
        port = int(os.getenv('DATA_AGENT_GATEWAY_PORT', '8443'))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        parser.error('DATA_AGENT_GATEWAY_PORT 必须是有效端口。')
    certificate = config_file('DATA_AGENT_GATEWAY_CERT')
    private_key = config_file('DATA_AGENT_GATEWAY_KEY')
    try:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, private_key)
    except (OSError, ValueError):
        parser.error('无法读取网关证书及私钥。')
    admin_password = os.getenv('DATA_AGENT_GATEWAY_ADMIN_PASSWORD', '').strip()
    labels_text = os.getenv('DATA_AGENT_GATEWAY_USER_LABELS', '').strip()
    usage_db_text = os.getenv('DATA_AGENT_GATEWAY_USAGE_DB', '').strip()
    if not admin_password and (labels_text or usage_db_text):
        parser.error('配置用户备注或使用记录目录时，需要设置独立的 DATA_AGENT_GATEWAY_ADMIN_PASSWORD。')
    try:
        labels = json.loads(labels_text) if labels_text else None
    except (ValueError, RecursionError):
        parser.error('DATA_AGENT_GATEWAY_USER_LABELS 必须是 JSON 对象。')
    if labels_text and not isinstance(labels, dict):
        parser.error('DATA_AGENT_GATEWAY_USER_LABELS 必须是 JSON 对象。')
    usage_db = None
    if admin_password:
        usage_db = Path(usage_db_text or 'gateway-usage.sqlite3').expanduser()
        if not usage_db.is_absolute():
            usage_db = config_path.parent / usage_db

    deep_service = None
    if deep_flag == '1':
        from deep_analysis.service import DeepAnalysisService

        value = os.getenv('DATA_AGENT_GATEWAY_DEEP_DIR', '').strip()
        if not value:
            parser.error('请设置独立的 DATA_AGENT_GATEWAY_DEEP_DIR。')
        directory = Path(value).expanduser()
        if not directory.is_absolute():
            directory = config_path.parent / directory
        if not deep_tokens or not set(deep_tokens).issubset(tokens):
            parser.error('请配置获准使用深度分析的独立网关令牌。')
        try:
            deep_service = DeepAnalysisService(directory.resolve())
        except (OSError, ValueError):
            parser.error('无法初始化远程深度分析，请检查运行配置和独立存储目录。')
    try:
        app = create_gateway(tokens, SqlSettings.from_env(), sql_enabled=sql_flag == '1', sql_tables=tables,
                             deep_service=deep_service, deep_tokens=deep_tokens if deep_service is not None else (),
                             admin_password=admin_password, usage_database=usage_db, user_labels=labels)
    except ValueError as exc:
        parser.error(str(exc))
    except (OSError, sqlite3.Error):
        parser.error('无法初始化网关使用记录，请检查配置目录是否可写。')
    except ImportError:
        parser.error('请先安装 requirements-gateway.txt。')
    uvicorn.run(app, host=os.getenv('DATA_AGENT_GATEWAY_HOST', '127.0.0.1').strip(),
                port=port, ssl_certfile=certificate, ssl_keyfile=private_key, workers=1,
                access_log=False, proxy_headers=False, limit_concurrency=32)


if __name__ == '__main__':
    main()
