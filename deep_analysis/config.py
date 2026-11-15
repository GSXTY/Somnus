"""Independent configuration. Never falls back to the ordinary chat credentials."""
import os
from urllib.parse import urlsplit


def _integer(name, default, minimum, maximum):
    raw = os.getenv(name, str(default))
    try:
        result = int(raw)
        if str(result) != raw.strip() or not minimum <= result <= maximum:
            raise ValueError()
        return result
    except (TypeError, ValueError):
        raise ValueError(f'{name} must be an integer between {minimum} and {maximum}') from None


class Config:
    def __init__(self, base_url=None, model=None, api_key=None):
        self.base_url = (base_url if base_url is not None else os.getenv('DEEP_ANALYSIS_BASE_URL', '')).strip().rstrip('/')
        self.model = (model if model is not None else os.getenv('DEEP_ANALYSIS_MODEL', '')).strip()
        self.api_key = (api_key if api_key is not None else os.getenv('DEEP_ANALYSIS_API_KEY', '')).strip()
        try:
            parts = urlsplit(self.base_url)
            self.configured = bool(parts.scheme in ('http', 'https') and parts.hostname and not parts.username
                                   and not parts.password and not parts.query and not parts.fragment and self.model and self.api_key)
        except ValueError:
            self.configured = False
        self.image = os.getenv('DEEP_ANALYSIS_DOCKER_IMAGE', 'ya70-deep-analysis:trial').strip()
        self.max_file_bytes = _integer('DEEP_ANALYSIS_MAX_FILE_MB', 5, 1, 20) * 1024**2
        self.max_rows = _integer('DEEP_ANALYSIS_MAX_ROWS', 100000, 1, 1000000)
        self.max_columns = _integer('DEEP_ANALYSIS_MAX_COLUMNS', 200, 1, 1000)
        self.max_rounds = _integer('DEEP_ANALYSIS_MAX_ROUNDS', 4, 1, 10)
        self.task_timeout = _integer('DEEP_ANALYSIS_TASK_TIMEOUT', 240, 10, 900)
        self.code_timeout = _integer('DEEP_ANALYSIS_CODE_TIMEOUT', 60, 1, 180)
        self.model_timeout = _integer('DEEP_ANALYSIS_MODEL_TIMEOUT', 60, 1, 180)
        self.max_output_bytes = 2 * 1024**2
        self.max_artifact_bytes = 10 * 1024**2
        self.max_artifacts_total = 30 * 1024**2
        self.max_tasks = 2

    @property
    def endpoint(self):
        return self.base_url if self.base_url.endswith('/chat/completions') else self.base_url + '/chat/completions'
