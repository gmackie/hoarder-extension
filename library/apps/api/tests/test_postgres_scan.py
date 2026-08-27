import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hoarder.app import create_app
from hoarder.models import Base
from sqlalchemy import create_engine


@pytest.mark.skipif(
    "HOARDER_TEST_DATABASE_URL" not in os.environ,
    reason="PostgreSQL integration URL is not configured",
)
def test_postgres_catalog_accepts_nanosecond_file_timestamps(tmp_path: Path) -> None:
    database_url = os.environ["HOARDER_TEST_DATABASE_URL"]
    engine = create_engine(database_url)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    media = tmp_path / "media"
    media.mkdir()
    (media / "reference.png").write_bytes(b"image-data")
    app = create_app(
        database_url=database_url,
        storage_roots=[{"key": "primary", "label": "Primary", "path": str(media)}],
    )

    try:
        with TestClient(app) as client:
            response = client.post("/api/scans")
            assert response.status_code == 200
            assert response.json()["discovered"] == 1
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()
