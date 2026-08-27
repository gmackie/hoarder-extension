from .app import create_app
from .settings import Settings

settings = Settings()
app = create_app(
    database_url=settings.database_url,
    derivative_root=settings.derivative_root,
    storage_roots=[root.model_dump() for root in settings.storage_roots],
)
