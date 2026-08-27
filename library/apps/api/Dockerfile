FROM python:3.12-slim

RUN pip install --no-cache-dir uv
WORKDIR /app

COPY library/apps/api/pyproject.toml library/apps/api/uv.lock ./
COPY library/apps/api/alembic.ini ./
COPY library/apps/api/migrations ./migrations
COPY library/apps/api/src ./src

RUN uv sync --frozen --no-dev

EXPOSE 8000
CMD ["sh", "-c", "uv run --no-sync alembic upgrade head && uv run --no-sync uvicorn hoarder.main:app --host 0.0.0.0 --port 8000"]
