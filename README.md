# Hoarder browser extension

Hoarder is a Manifest V3 extension for Brave and other Chromium browsers. It
submits downloadable videos to your own MeTube or TubeArchivist instance and
can upload images to an optional catalog API.

The extension ships without hostnames, storage names, API keys, or project-run
cloud services. You configure one or more archive targets in the popup and can
switch the active target at any time.

## Features

- Optional automatic saving of detected video pages and direct media URLs.
- Toolbar icons show when a submission is pending, accepted, or failed.
- A popup link opens the active target's download queue or dashboard.
- Multiple named archive targets with independent service URLs and folders.
- MeTube support for arbitrary download folders.
- Optional TubeArchivist routing for YouTube.
- Optional image uploads from the browser context menu.
- Destination-aware history deduplication.
- Fail-closed availability checks for removable or network-mounted storage.
- One-time migration from the earlier single-NAS configuration format.

## Install in Brave

### Prebuilt release on macOS

This path does not require Node.js. Download the installer, then stage a
checksummed release in a stable per-user directory:

```sh
curl -fsSLo install-hoarder.sh \
  https://raw.githubusercontent.com/gmackie/hoarder-extension/v1.0.6/scripts/install-macos.sh
sh install-hoarder.sh \
  --version 1.0.6
```

Then open `brave://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select:

```text
~/Library/Application Support/Hoarder Extension/current
```

To preconfigure targets on a new browser profile, start with
`config.example.json`, keep the edited copy outside the repository, and add
`--config /path/to/your-config.json` to the command. The configuration is
copied only into the local installation and is never uploaded to GitHub.

Run the same command with a newer version to update. The installer downloads
and verifies the checksum published beside that release. It preserves an
existing `local-config.json`; click **Reload** on the extension card in Brave
after updating. Browser-saved target settings are stored in the Brave profile
and are also retained.

The installer also supports `--archive /path/to/release.zip --sha256 HASH` for
offline use and `--release-base-url URL` for forks or release mirrors. Run
`sh install-hoarder.sh --help` for all options. It never restarts Brave or
modifies a browser profile.

### Build from source

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

Services reachable only over Tailscale work normally: use the service's
Tailscale HTTPS URL or MagicDNS hostname as the MeTube URL. For example, two
targets can point at the same MeTube URL while selecting different folders, or
each target can point at a separate MeTube instance. Names such as “Home NAS”
and “Backup NAS” are display labels chosen by the user; none are hardcoded.

`config.example.json` documents the stored configuration schema. Secrets are
intentionally blank. For repeatable preconfiguration, copy it to
`local-config.json` before running the build. That ignored file is bundled into
your local build and imported only when the browser profile has no saved target
configuration.

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

The blue toolbar hourglass appears while Hoarder is submitting a URL. A green
checkmark means the configured service accepted the submission into its queue;
it does not mean a multi-minute media download has already finished. A red X
means the submission failed. Open the popup and choose **Open dashboard /
queue** to follow the downloader's actual progress.

## Server-side deletion policy

Hoarder submits downloads but never deletes archived media. Removing an item
from MeTube's **Completed** list also preserves the downloaded file by default.
This is controlled by MeTube, not by the extension.

If every user of a MeTube instance should permanently delete media when using
its trash action, the server administrator can set
`DELETE_FILE_ON_TRASHCAN=true`. That setting is global and destructive: it
applies to completed downloads submitted by Hoarder and by every other MeTube
client. Leave the default `false` when Completed is only workflow history.

See MeTube's
[download behavior configuration](https://github.com/alexta69/metube#%EF%B8%8F-configuration-via-environment-variables)
for the authoritative server-side semantics.

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
