"""Session-scoped FastAPI access to the existing detection engine."""
from .routes import DetectionRuntime, install_routes

__all__ = ['DetectionRuntime', 'install_routes']
