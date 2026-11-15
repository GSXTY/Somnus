"""HTTP-backed annotation store (not wired yet).

The local analysis stays on each workstation; results are meant to live on a
shared server so the whole team reads the same batches and reviews. Until the
server exposes the sync endpoints, constructing this store fails fast instead
of silently falling back to a local database.
"""
from .event_store import Store


class RemoteHttpStore(Store):
    """Placeholder for the server-backed store.

    Expected contract (single source of truth on the server):
      GET  /api/records/{file_id}                -> {file_id, revision, events}
      PUT  /api/records/{file_id}                -> revision-checked write
      GET  /api/records/{file_id}/scans          -> batches
      POST /api/records/{file_id}/scans/{run_id} -> rename / archive
      POST /api/sync/ingest                      -> upload a batch summary
    """

    def __init__(self, base_url):
        url = (base_url or '').strip()
        if not url:
            raise ValueError('AI_AGENT_SERVER_URL 未配置，无法使用远程存储。')
        raise NotImplementedError('远程存储尚未接入：需要先实现服务器端 /api/sync 接口。')
