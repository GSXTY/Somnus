"""Ephemeral capabilities for the app-owned DSH NEXT Host."""
from dataclasses import dataclass, field
import secrets
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
    model: object | None
    model_token: str = field(default_factory=lambda: secrets.token_hex(32))
    revision: object = None
    provider_metadata: dict | None = None
    subagents: dict = field(default_factory=dict)
    retired_models: list = field(default_factory=list)

    def close(self):
        self.cancel.set()
        self.model_cancel.set()
        for _, cancel in self.retired_models:
            cancel.set()
        self.retired_models.clear()


class DshNextRuntime:
    def __init__(self, service):
        self.service = service
        self.host = None

    def _refresh_model(self, host):
        """Replace only future model admissions, retaining active stream snapshots."""
        if company_runtime.configured_providers_only():
            rows, revision = company_runtime.configured_roster(self.service)
            if host.revision == revision:
                return
            model, provider = None, None
            if rows:
                from .service import Config
                model = company_runtime.ProviderRosterLease(
                    rows, lambda row: Config.from_provider(row, timeout=self.service.config.timeout), host.subagents)
                model.revision = revision
                models = []
                for row in rows:
                    item = dict(model=row['id'], name=row['model'], vision=row['vision_enabled'],
                                reasoning_efforts=row['reasoning_efforts'], api=row['api'])
                    item.update({key: row[key] for key in ('context_window', 'max_output_tokens')
                                 if row.get(key) is not None})
                    models.append(item)
                provider = dict(model=rows[0]['id'], token=host.model_token, revision=revision, models=models)
        else:
            config, revision = self.service.company_provider()
            options = company_runtime.info(config)
            # A missing legacy revision is still a meaningful resolved generation.
            revision = (revision, bool(options))
            if host.revision == revision:
                return
            model = company_runtime.ModelLease(config, options) if options else None
            provider = (dict(options, token=host.model_token, revision=revision[0],
                             models=company_runtime.catalog(config)) if options else None)
        if model:
            model.token = host.model_token
        retained = []
        for previous, cancel in host.retired_models:
            if previous.in_flight:
                retained.append((previous, cancel))
            else:
                cancel.set()
        if host.model:
            if host.model.in_flight:
                retained.append((host.model, host.model_cancel))
            else:
                host.model_cancel.set()
        host.retired_models = retained
        host.model, host.model_cancel = model, threading.Event()
        host.provider_metadata, host.revision = provider, revision

    def open(self, remote):
        cancel = threading.Event()
        running = threading.BoundedSemaphore(4)
        servers = {server_id: WebDataMcp(remote, cancel, server_id, running) for server_id in DATA_MCP_NAMES}
        with self.service.lock:
            previous = self.host
            settings = self.service.delegation_settings()
            subagents = {'maxDepth': settings['dsh_max_depth'] if settings['enabled'] else 0,
                         'maxActiveSubagents': settings['dsh_max_active']}
            host = HostLease(uuid.uuid4().hex, cancel, servers, threading.Event(), None, subagents=subagents)
            self._refresh_model(host)
            self.host = host
            if previous:
                previous.close()
        return {
            'id': host.id,
            'model_token': host.model_token,
            'data_servers': [{'id': ident, 'token': server.token} for ident, server in servers.items()],
            'subagents': subagents,
            'provider': host.provider_metadata,
        }

    def catalog(self, ident):
        with self.service.lock:
            host = self.host
            if not host or host.id != ident:
                return None
            self._refresh_model(host)
            revision = host.revision if isinstance(host.revision, str) else host.revision[0]
            return dict(revision=revision, provider=host.provider_metadata)

    def close(self, ident):
        with self.service.lock:
            if not self.host or self.host.id != ident:
                return False
            self.host.close()
            self.host = None
            return True

    def revoke_model(self):
        # Configuration changes invalidate future admissions. A currently streaming
        # request owns its immutable lease and must not be interrupted by UI edits.
        with self.service.lock:
            if self.host:
                self.host.revision = None

    def provider(self, ident):
        with self.service.lock:
            if self.host and self.host.id == ident:
                self._refresh_model(self.host)
                if self.host.model:
                    return self.host.model, self.host.model_cancel
            return None

    def server(self, ident, server_id, token):
        with self.service.lock:
            server = self.host.servers.get(server_id) if self.host and self.host.id == ident else None
            return server if server and server.allows(token) else None
