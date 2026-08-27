# Hoarder Library

Hoarder Library is the local, storage-first browser for media saved by the
Hoarder extension and other download services. It treats mounted files as the
physical source of truth and keeps editorial metadata in PostgreSQL.

This first vertical slice includes:

- Multiple configurable, read-only media roots.
- Sentinel-based online, degraded, and offline root health.
- Idempotent scanning for video, audio, and image files.
- Queued background scans with live status in the Jobs lens.
- Full fingerprints for small files and bounded head/middle/tail fingerprints
  for large media so first-time NAS scans stay practical.
- Stable asset identity when a file moves.
- One catalog asset for duplicate copies across multiple roots.
- Search, media-type filtering, pagination, and HTTP Range streaming.
- Source-channel discovery, local channel artwork, and channel-filtered catalogs.
- Durable ratings, favorites, workflow state, notes, and normalized tags.
- Ordered curated channels with per-channel candidate/review/selection status.
- Durable scan-job history.
- A responsive PWA with Inbox, Videos, Music, Images, Source Channels,
  Curated Channels, and Jobs navigation.
- In-app video, audio, and image inspection with explicit original downloads.
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
`HOARDER_DB_DATA` can be a Docker volume name or an absolute host path on
persistent storage.

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

The scan request returns `202 Accepted` immediately. Open the Jobs lens, or
poll `/api/jobs`, to follow the queued, running, completed, or failed state.
Submitting another scan while one is active returns the existing job instead
of starting overlapping storage walks.

The default Compose configuration has two generic roots. Labels, paths, root
keys, and sentinels come from `HOARDER_STORAGE_ROOTS`; no private hostnames or
NAS names are compiled into the application. Additional roots can be added
with a Compose override that supplies another read-only mount and includes it
in the JSON configuration.

Each root can also define `exclude_patterns` and `thumbnail_patterns` using
paths relative to that root. Use exclusions for generated downloader caches and
derivatives that should not appear as library assets. Thumbnail patterns let
the catalog reuse artwork from those caches on matching video or audio assets.
Patterns support `{stem}`, `{first}` (the lower-case first character of the
stem), and `{parent}` placeholders:

```json
{
  "key": "archive",
  "label": "Archive",
  "path": "/media/primary",
  "sentinel": ".hoarder-root",
  "exclude_patterns": ["youtube-cache/**", "temporary/**"],
  "thumbnail_patterns": ["youtube-cache/videos/{first}/{stem}.jpg"]
}
```

Exclusions affect catalog metadata only. The scanner never removes or changes
the underlying files, and previously indexed excluded-only assets disappear
from normal browsing after the next successful scan. Matching thumbnail files
remain available as card artwork and video-player posters without becoming
standalone entries in the Images lens.

### Organize media by source channel

Channel discovery is also root-specific and does not depend on a particular
downloader. `channel_path_prefixes` lists the directories whose next path
segment identifies a channel. For example, `youtube/UC123/video.mp4` belongs
to channel `UC123` when the prefix is `youtube`.

An optional root-relative `channel_metadata_path` can add friendly titles and
subscriber counts. `channel_thumbnail_patterns` locates existing channel art;
it supports the `{channel_id}` placeholder. None of these files are copied or
modified by the library.

```json
{
  "key": "archive",
  "label": "Archive",
  "path": "/media/primary",
  "exclude_patterns": ["youtube-cache/**", "hoarder-metadata/**"],
  "channel_path_prefixes": ["youtube"],
  "channel_metadata_path": "hoarder-metadata/channels.json",
  "channel_thumbnail_patterns": [
    "youtube-cache/channels/{channel_id}_thumb.jpg"
  ]
}
```

The metadata file is deliberately downloader-neutral so other users can
generate it from TubeArchivist, yt-dlp sidecars, or their own catalog:

```json
{
  "channels": {
    "UC123": {
      "title": "Example Channel",
      "subscribers": 125000
    }
  }
}
```

If the metadata or artwork is absent, channel browsing still works and falls
back to the directory identifier and a generated initial. The corresponding
resource endpoints are `GET /api/channels`,
`GET /api/channels/{channel_id}/assets`, and
`GET /api/channels/{channel_id}/thumbnail`.

## Evaluate and curate assets

Open any asset in the library to review it alongside playback. Ratings use a
one-to-five scale; favorites, notes, tags, and workflow state are optional.
The keyboard shortcuts `1`–`5` set a rating, `F` toggles favorite, the left and
right arrows move through the current catalog or curated-channel queue, and
`Esc` closes the viewer when focus is not inside a form field. **Save and next**
persists the evaluation before advancing.

Editorial metadata is stored against the stable asset ID rather than a file
path, so rescans and reconciled file moves do not overwrite it. Tags are
trimmed, case-folded, deduplicated, and shared across media types. Catalog and
source-channel queries accept `favorite`, `workflow_state`, and `tag` filters:

```text
GET /api/assets?media_type=video&favorite=true&workflow_state=reviewed&tag=history
GET /api/channels/{channel_id}/assets?favorite=true&tag=featured
GET /api/assets/{asset_id}/editorial
PATCH /api/assets/{asset_id}/editorial
```

Curated channels are user-owned, ordered collections. Adding an asset creates
only a catalog membership; it never copies or moves the media file. Each
membership has its own `candidate`, `reviewed`, `selected`, `used`, or
`rejected` state, and reordering normalizes every position in one transaction.
The PWA supports creation, editing, deletion, assignment from the asset viewer,
status changes, removal, and up/down ordering through these resources:

```text
GET|POST /api/curated-channels
GET|PATCH|DELETE /api/curated-channels/{channel_id}
GET|POST /api/curated-channels/{channel_id}/items
PATCH|DELETE /api/curated-channels/{channel_id}/items/{asset_id}
```

## Run on a NAS over Tailscale

Use the NAS Tailscale IPv4 address as `HOARDER_BIND_ADDRESS`, keep each media
root mounted read-only by Compose, and place the database on persistent local
storage:

```dotenv
HOARDER_BIND_ADDRESS=100.x.y.z
HOARDER_PORT=8088
HOARDER_DB_DATA=/persistent/apps/hoarder-library/postgres
HOARDER_MEDIA_ROOT_1=/local/archive
HOARDER_MEDIA_ROOT_2=/mounted/secondary-archive
HOARDER_STORAGE_ROOTS=[{"key":"local","label":"Local NAS","path":"/media/primary","sentinel":".hoarder-root"},{"key":"secondary","label":"Secondary NAS","path":"/media/secondary","sentinel":".hoarder-root"}]
```

Generate a unique `HOARDER_DB_PASSWORD`, protect `.env` with mode `0600`, and
create `.hoarder-root` inside each host media root before starting the stack.
The app will then be available only at `http://<tailscale-host-or-ip>:8088`.

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
