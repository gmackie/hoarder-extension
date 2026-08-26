# Hoarder browser extension

Hoarder is a Manifest V3 extension for Brave and other Chromium browsers. It
submits downloadable videos to your own MeTube or TubeArchivist instance and
can upload images to an optional catalog API.

The extension ships without hostnames, storage names, API keys, or project-run
cloud services. You configure one or more archive targets in the popup and can
switch the active target at any time.

## Features

- Optional automatic saving of detected video pages and direct media URLs.
- Multiple named archive targets with independent service URLs and folders.
- MeTube support for arbitrary download folders.
- Optional TubeArchivist routing for YouTube.
- Optional image uploads from the browser context menu.
- Destination-aware history deduplication.
- Fail-closed availability checks for removable or network-mounted storage.
- One-time migration from the earlier single-NAS configuration format.

## Install in Brave

Requirements: Node.js 22 or newer and a reachable MeTube instance.

```sh
git clone https://github.com/gmackie/hoarder-extension.git
cd hoarder-extension
npm ci
npm run check
```

Then:

1. Open `brave://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository's `dist/brave` directory.
5. Open Hoarder, expand **Archive targets and auto-save**, and add a target.

The same unpacked extension also works in Chrome via `chrome://extensions`.

## Configure an archive target

Only the target name and the services you use need values.

| Field | Purpose |
| --- | --- |
| MeTube URL | Base URL of the MeTube instance used for most video downloads. |
| MeTube folder | Optional folder below MeTube's `/downloads` directory. |
| TubeArchivist URL and API key | Optional YouTube-specific downloader. |
| Use TubeArchivist for YouTube | Routes recognized YouTube URLs to TubeArchivist. |
| Image API URL | Optional API implementing `POST /upload`. |
| Image destination key | Optional `destination` form value sent to the image API. |
| Availability destination id | Optional id checked through `GET /destinations` before saving. |

To use multiple disks or NAS devices behind one MeTube instance, add multiple
targets with the same MeTube URL and different folder values. Bind-mount each
folder to the desired storage location in the MeTube container.

`config.example.json` documents the stored configuration schema. Secrets are
intentionally blank.

## Automatic video saving

Auto-save is opt-in. Enable **Automatically save detected videos** after the
active target works manually.

Hoarder currently recognizes:

- YouTube watch, Shorts, live, and `youtu.be` URLs.
- Twitch clips and VOD URLs.
- SoundCloud track pages.
- Direct HTTP(S) video URLs ending in common media extensions.
- Direct HTTP(S) sources exposed by HTML5 `<video>` elements.

Ordinary pages, platform home pages, and `blob:`-only players are ignored. The
configured delay allows single-page applications time to expose their media.
MeTube history prevents the same URL and folder from being queued repeatedly.

## Image API contract

Image support is optional. The configured API must accept `POST /upload` as
multipart form data with `image`, `source_url`, `page_title`, optional `tags`,
and optional `destination` fields.

When an availability id is configured, `GET /destinations` must return:

```json
{
  "destinations": [
    { "id": "archive", "available": true }
  ]
}
```

The extension refuses the save when the requested destination is unavailable.

## Privacy and permissions

Hoarder runs locally and contains no telemetry. Its broad page and cookie
permissions are necessary to detect direct media, support authenticated
downloads, and call user-configured self-hosted endpoints. Cookies are sent
only to the active archive target during a submission. Configure only services
you trust and prefer HTTPS or a private network such as Tailscale.

See [SECURITY.md](SECURITY.md) for the full permission model.

## Development

```sh
npm ci
npm run test:watch
npm run check
```

The build output is `dist/brave`. Pull requests run lint, tests, and the build
through GitHub Actions.

## License

MIT
