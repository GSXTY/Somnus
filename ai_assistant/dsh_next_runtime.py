"""Ephemeral capabilities for the app-owned DSH NEXT Host."""
from dataclasses import dataclass
import threading
import uuid

from . import company_runtime
from .web_data_mcp import DATA_MCP_NAMES, WebDataMcp


@dataclass
class HostLease:
    id: str
    cancel: threading.Event
    servers: dict
    model_cancel: threading.Event
    model: company_runtime.ModelLease | None

    def close(self):
        self.cancel.set()
        self.model_cancel.set()


class DshNextRuntime:
    def __init__(self, service):
        self.service = service
        self.host = None

    def open(self, remote):
        cancel = threading.Event()
        running = threading.BoundedSemaphore(4)
        servers = {server_id: WebDataMcp(remote, cancel, server_id, running) for server_id in DATA_MCP_NAMES}
        with self.service.lock:
            previous = self.host
            settings = self.service.delegation_settings()
            config, revision = self.service.company_provider()
            options = company_runtime.info(config)
            model = company_runtime.ModelLease(config, options) if options else None
            self.host = host = HostLease(uuid.uuid4().hex, cancel, servers, threading.Event(), model)
            if previous:
                previous.close()
        return {
            'id': host.id,
            'data_servers': [{'id': ident, 'token': server.token} for ident, server in servers.items()],
            'subagents': {'maxDepth': settings['dsh_max_depth'] if settings['enabled'] else 0,
                          'maxActiveSubagents': settings['dsh_max_active']},
            'provider': dict(options, token=model.token, revision=revision,
                             models=company_runtime.catalog(config)) if model else None,
        }

    def close(self, ident):
        with self.service.lock:
            if not self.host or self.host.id != ident:
                return False
            self.host.close()
            self.host = None
            return True

    def revoke_model(self):
        with self.service.lock:
            if self.host:
                self.host.model_cancel.set()
                self.host.model = None

    def provider(self, ident):
        with self.service.lock:
            if self.host and self.host.id == ident and self.host.model:
                return self.host.model, self.host.model_cancel
            return None

    def server(self, ident, server_id, token):
        with self.service.lock:
            server = self.host.servers.get(server_id) if self.host and self.host.id == ident else None
            return server if server and server.allows(token) else None
