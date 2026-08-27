# Hoarder Library

Hoarder Library is the local, storage-first browser for media saved by the
Hoarder extension and other download services. It treats mounted files as the
physical source of truth and keeps editorial metadata in PostgreSQL.

This first vertical slice includes:

- Multiple configurable, read-only media roots.
- Sentinel-based online, degraded, and offline root health.
- Idempotent scanning for video, audio, and image files.
- Stable asset identity when a file moves.
- One catalog asset for duplicate copies across multiple roots.
- Search, media-type filtering, pagination, and HTTP Range streaming.
- Durable scan-job history.
- A responsive PWA with Inbox, Videos, Music, Images, Source Channels,
  Curated Channels, and Jobs navigation.
- PostgreSQL migrations and a Docker Compose deployment.

## Run locally

Requirements: Docker with Compose v2.

```sh
cp .env.example .env
```

Set `HOARDER_MEDIA_ROOT_1` and `HOARDER_MEDIA_ROOT_2` to the host paths that
contain your media. Place a sentinel file named `.hoarder-root` at the top of
each root:

```sh
touch /path/to/primary/media/.hoarder-root
touch /path/to/secondary/media/.hoarder-root
```

`HOARDER_BIND_ADDRESS` controls which host interface publishes the library.
Use `127.0.0.1` for local-only access, a Tailscale IP for tailnet-only access,
or `0.0.0.0` when access from every host interface is intentional.

The sentinel prevents an unavailable network mount from looking like an empty
directory and incorrectly transitioning catalog items to missing.

Start the stack:

```sh
docker compose up -d --build
open http://localhost:8088
```

Trigger a scan and inspect health:

```sh
curl -X POST http://localhost:8088/api/scans
curl http://localhost:8088/api/health
curl http://localhost:8088/api/roots
```

The default Compose configuration has two generic roots. Labels, paths, root
keys, and sentinels come from `HOARDER_STORAGE_ROOTS`; no private hostnames or
NAS names are compiled into the application. Additional roots can be added
with a Compose override that supplies another read-only mount and includes it
in the JSON configuration.

## Development

API tests use SQLite for fast behavior coverage:

```sh
cd library/apps/api
uv sync
uv run pytest
```

The PostgreSQL integration test is enabled by setting
`HOARDER_TEST_DATABASE_URL` to a disposable database. It drops only the schema
in that explicitly configured test database.

PWA tests and build:

```sh
npm run library:web:test
npm run library:web:build
```

Run the API directly with environment-based configuration:

```sh
cd library/apps/api
HOARDER_DATABASE_URL=sqlite:///./catalog.db \
HOARDER_STORAGE_ROOTS='[{"key":"media","label":"Media","path":"/path/to/media"}]' \
uv run uvicorn hoarder.main:app --reload
```

Run the PWA development server from the repository root:

```sh
npm run library:web:dev
```

Vite proxies `/api` to `http://127.0.0.1:8000` during development.

## Safety model

- Media roots are mounted read-only in Compose.
- The scanner never deletes or renames originals.
- A root must be online before absent files can become missing.
- A missing sentinel produces `degraded`, not `online`.
- Streaming resolves catalog IDs inside their configured roots and fails
  closed for stale or escaping paths.
- Downloader history will be imported only as provenance hints; it cannot
  invent an available physical file.

The approved architecture and remaining delivery phases are in
`docs/plans/2026-08-27-hoarder-library-design.html`.
