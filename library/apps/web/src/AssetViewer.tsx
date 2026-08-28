import { type FormEvent, useEffect, useState } from "react";

export type EditorialState = {
  asset_id: string;
  rating: number | null;
  favorite: boolean;
  workflow_state: "inbox" | "candidate" | "reviewed" | "selected" | "archived";
  notes: string;
  tags: string[];
};

export type Asset = {
  id: string;
  title: string;
  media_type: "video" | "audio" | "image";
  status: string;
  thumbnail_url?: string | null;
  editorial?: EditorialState;
  files: Array<{ id: number; relative_path: string; size: number }>;
  origins?: Array<{
    source_url: string;
    page_url: string;
    page_title: string;
    original_filename: string;
    destination: string;
    captured_at: string;
  }>;
};

type CuratedChannelSummary = {
  id: string;
  name: string;
  description: string;
  item_count: number;
};

type AssetViewerProps = {
  apiBase: string;
  asset: Asset;
  canNavigateNext?: boolean;
  canNavigatePrevious?: boolean;
  onClose: () => void;
  onEditorialSaved?: (editorial: EditorialState) => void;
  onNavigateNext?: () => void;
  onNavigatePrevious?: () => void;
};

const EMPTY_EDITORIAL: Omit<EditorialState, "asset_id"> = {
  rating: null,
  favorite: false,
  workflow_state: "inbox",
  notes: "",
  tags: [],
};

export function AssetViewer({
  apiBase,
  asset,
  canNavigateNext = false,
  canNavigatePrevious = false,
  onClose,
  onEditorialSaved,
  onNavigateNext,
  onNavigatePrevious,
}: AssetViewerProps) {
  const streamUrl = `${apiBase}/api/assets/${asset.id}/stream`;
  const thumbnailUrl = asset.thumbnail_url
    ? `${apiBase}${asset.thumbnail_url}`
    : undefined;
  const file = asset.files[0];
  const extension = file?.relative_path.split(".").pop()?.toLowerCase();
  const [editorial, setEditorial] = useState<EditorialState>(
    asset.editorial ?? { asset_id: asset.id, ...EMPTY_EDITORIAL },
  );
  const [tagsDraft, setTagsDraft] = useState(editorial.tags.join(", "));
  const [channels, setChannels] = useState<CuratedChannelSummary[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [audioDraft, setAudioDraft] = useState({
    title: asset.title,
    artist: "",
    release: "",
    year: "",
    trackNumber: "",
    genre: "",
    tags: "",
    start: "00:00:00",
    end: "",
    format: "m4a",
    bitrate: "256",
  });

  useEffect(() => {
    let active = true;
    const initialEditorial = asset.editorial ?? { asset_id: asset.id, ...EMPTY_EDITORIAL };
    setEditorial(initialEditorial);
    setTagsDraft(initialEditorial.tags.join(", "));
    setSelectedChannelId("");
    setStatusMessage(null);
    setError(null);
    setAudioDraft({
      title: asset.title, artist: "", release: "", year: "", trackNumber: "",
      genre: "", tags: "", start: "00:00:00", end: "", format: "m4a", bitrate: "256",
    });
    Promise.all([
      fetch(`${apiBase}/api/assets/${asset.id}/editorial`).then((response) => {
        if (!response.ok) throw new Error(`Evaluation request failed (${response.status})`);
        return response.json() as Promise<EditorialState>;
      }),
      fetch(`${apiBase}/api/curated-channels`).then((response) => {
        if (!response.ok) throw new Error(`Channel request failed (${response.status})`);
        return response.json() as Promise<{ items: CuratedChannelSummary[] }>;
      }),
    ])
      .then(([nextEditorial, channelPayload]) => {
        if (!active) return;
        setEditorial(nextEditorial);
        setTagsDraft(nextEditorial.tags.join(", "));
        setChannels(channelPayload.items);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Metadata request failed");
        }
      });
    return () => {
      active = false;
    };
  }, [apiBase, asset.id]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "ArrowLeft" && canNavigatePrevious) {
        event.preventDefault();
        onNavigatePrevious?.();
      } else if (event.key === "ArrowRight" && canNavigateNext) {
        event.preventDefault();
        onNavigateNext?.();
      } else if (/^[1-5]$/.test(event.key)) {
        setEditorial((current) => ({ ...current, rating: Number(event.key) }));
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setEditorial((current) => ({ ...current, favorite: !current.favorite }));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [canNavigateNext, canNavigatePrevious, onClose, onNavigateNext, onNavigatePrevious]);

  async function persistEditorial(): Promise<boolean> {
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    const tags = tagsDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    const payload = {
      rating: editorial.rating,
      favorite: editorial.favorite,
      workflow_state: editorial.workflow_state,
      notes: editorial.notes,
      tags,
    };
    try {
      const response = await fetch(`${apiBase}/api/assets/${asset.id}/editorial`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Evaluation save failed (${response.status})`);
      const saved = (await response.json()) as EditorialState;
      setEditorial(saved);
      setTagsDraft(saved.tags.join(", "));
      onEditorialSaved?.(saved);
      setStatusMessage("Evaluation saved");
      return true;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Evaluation save failed");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveEditorial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await persistEditorial();
  }

  async function saveAndNavigateNext() {
    if (await persistEditorial()) onNavigateNext?.();
  }

  async function addToChannel() {
    const channel = channels.find((candidate) => candidate.id === selectedChannelId);
    if (!channel) return;
    setSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      const response = await fetch(
        `${apiBase}/api/curated-channels/${encodeURIComponent(channel.id)}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset_id: asset.id, status: "candidate" }),
        },
      );
      if (!response.ok) {
        const message = response.status === 409
          ? "This asset is already in that channel"
          : `Channel assignment failed (${response.status})`;
        throw new Error(message);
      }
      setStatusMessage(`Added to ${channel.name}`);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Channel assignment failed");
    } finally {
      setSaving(false);
    }
  }

  async function createAudioTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExtracting(true);
    setError(null);
    setStatusMessage(null);
    try {
      const startMs = parseTimecode(audioDraft.start);
      const endMs = audioDraft.end.trim() ? parseTimecode(audioDraft.end) : null;
      if (endMs !== null && endMs <= startMs) {
        throw new Error("End time must be after start time");
      }
      const response = await fetch(`${apiBase}/api/assets/${asset.id}/audio-extractions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: audioDraft.title.trim(),
          artist: audioDraft.artist.trim(),
          release: audioDraft.release.trim(),
          year: audioDraft.year ? Number(audioDraft.year) : null,
          track_number: audioDraft.trackNumber ? Number(audioDraft.trackNumber) : null,
          genre: audioDraft.genre.trim(),
          tags: audioDraft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          start_ms: startMs,
          end_ms: endMs,
          format: audioDraft.format,
          bitrate_kbps: Number(audioDraft.bitrate),
        }),
      });
      if (!response.ok) {
        const message = response.status === 409
          ? "That range and format already exists in the music library"
          : `Audio extraction request failed (${response.status})`;
        throw new Error(message);
      }
      setStatusMessage("Audio extraction queued — follow it in Jobs");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Audio extraction request failed");
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="viewer-backdrop" onMouseDown={onClose}>
      <section
        aria-labelledby="viewer-title"
        aria-modal="true"
        className="asset-viewer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="viewer-header">
          <div>
            <span>{asset.media_type}</span>
            <h2 id="viewer-title">{asset.title}</h2>
          </div>
          <button aria-label="Close viewer" className="viewer-close" onClick={onClose} type="button">
            ×
          </button>
        </header>

        <div className="viewer-workspace">
          <div className="viewer-stage">
            {asset.media_type === "video" ? (
              <video controls poster={thumbnailUrl} preload="metadata" src={streamUrl} />
            ) : null}
            {asset.media_type === "audio" ? (
              <audio controls preload="metadata" src={streamUrl} />
            ) : null}
            {asset.media_type === "image" ? (
              <img alt={asset.title} src={streamUrl} />
            ) : null}
          </div>

          <aside className="editorial-panel">
            <form onSubmit={saveEditorial}>
              <div className="editorial-heading">
                <div>
                  <span>Evaluation</span>
                  <strong>Review this asset</strong>
                </div>
                <button
                  aria-keyshortcuts="f"
                  aria-label="Favorite"
                  aria-pressed={editorial.favorite}
                  className="favorite-button"
                  onClick={() => setEditorial((current) => ({
                    ...current,
                    favorite: !current.favorite,
                  }))}
                  type="button"
                >
                  {editorial.favorite ? "★ Favorite" : "☆ Favorite"}
                </button>
              </div>
              <fieldset className="rating-control">
                <legend>Rating</legend>
                <div>
                  {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                      aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
                      aria-pressed={editorial.rating === rating}
                      key={rating}
                      onClick={() => setEditorial((current) => ({ ...current, rating }))}
                      type="button"
                    >
                      ★
                    </button>
                  ))}
                </div>
              </fieldset>
              <label>
                Workflow state
                <select
                  onChange={(event) => setEditorial((current) => ({
                    ...current,
                    workflow_state: event.target.value as EditorialState["workflow_state"],
                  }))}
                  value={editorial.workflow_state}
                >
                  <option value="inbox">Inbox</option>
                  <option value="candidate">Candidate</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="selected">Selected</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <label>
                Tags
                <input
                  onChange={(event) => setTagsDraft(event.target.value)}
                  placeholder="history, music, reference"
                  value={tagsDraft}
                />
              </label>
              <label>
                Notes
                <textarea
                  onChange={(event) => setEditorial((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))}
                  rows={4}
                  value={editorial.notes}
                />
              </label>
              <div className="editorial-save-actions">
                <button className="primary-action" disabled={saving} type="submit">
                  {saving ? "Saving…" : "Save evaluation"}
                </button>
                <button
                  disabled={saving || !canNavigateNext}
                  onClick={() => void saveAndNavigateNext()}
                  type="button"
                >
                  Save and next
                </button>
              </div>
            </form>

            {asset.media_type === "image" && asset.origins?.length ? (
              <section aria-label="Image provenance" className="image-provenance">
                <div className="editorial-heading">
                  <div>
                    <span>Provenance</span>
                    <strong>Saved from the browser</strong>
                  </div>
                </div>
                {asset.origins.map((origin) => (
                  <article key={`${origin.destination}:${origin.page_url}:${origin.source_url}`}>
                    <div>
                      <span>Source page</span>
                      {origin.page_url ? (
                        <a href={origin.page_url} rel="noreferrer" target="_blank">
                          {origin.page_title || "Source page"}
                        </a>
                      ) : <strong>{origin.page_title || "Unknown page"}</strong>}
                    </div>
                    <div><span>Destination</span><strong>{formatDestination(origin.destination)}</strong></div>
                    <div><span>Original name</span><strong>{origin.original_filename || "Unknown"}</strong></div>
                    {origin.source_url ? (
                      <a href={origin.source_url} rel="noreferrer" target="_blank">
                        Original image URL
                      </a>
                    ) : null}
                  </article>
                ))}
              </section>
            ) : null}

            <div className="channel-assignment">
              <label>
                Curated channel
                <select
                  onChange={(event) => setSelectedChannelId(event.target.value)}
                  value={selectedChannelId}
                >
                  <option value="">Choose a channel…</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>{channel.name}</option>
                  ))}
                </select>
              </label>
              <button
                disabled={!selectedChannelId || saving}
                onClick={addToChannel}
                type="button"
              >
                Add to channel
              </button>
            </div>
            {asset.media_type === "video" || asset.media_type === "audio" ? (
              <details className="audio-extraction" open={asset.media_type === "video"}>
                <summary>Create music track</summary>
                <form onSubmit={createAudioTrack}>
                  <label>Track title<input aria-label="Track title" required value={audioDraft.title} onChange={(event) => setAudioDraft({ ...audioDraft, title: event.target.value })} /></label>
                  <label>Artist<input aria-label="Artist" value={audioDraft.artist} onChange={(event) => setAudioDraft({ ...audioDraft, artist: event.target.value })} /></label>
                  <label>Release<input aria-label="Release" value={audioDraft.release} onChange={(event) => setAudioDraft({ ...audioDraft, release: event.target.value })} /></label>
                  <div className="compact-fields">
                    <label>Year<input aria-label="Release year" min="1000" max="9999" type="number" value={audioDraft.year} onChange={(event) => setAudioDraft({ ...audioDraft, year: event.target.value })} /></label>
                    <label>Track<input aria-label="Track number" min="1" type="number" value={audioDraft.trackNumber} onChange={(event) => setAudioDraft({ ...audioDraft, trackNumber: event.target.value })} /></label>
                  </div>
                  <label>Genre<input aria-label="Genre" value={audioDraft.genre} onChange={(event) => setAudioDraft({ ...audioDraft, genre: event.target.value })} /></label>
                  <label>Audio tags<input aria-label="Audio tags" placeholder="music, live, favorite" value={audioDraft.tags} onChange={(event) => setAudioDraft({ ...audioDraft, tags: event.target.value })} /></label>
                  <div className="compact-fields">
                    <label>Start time<input aria-label="Start time" placeholder="HH:MM:SS" value={audioDraft.start} onChange={(event) => setAudioDraft({ ...audioDraft, start: event.target.value })} /></label>
                    <label>End time<input aria-label="End time" placeholder="optional" value={audioDraft.end} onChange={(event) => setAudioDraft({ ...audioDraft, end: event.target.value })} /></label>
                  </div>
                  <div className="compact-fields">
                    <label>Format<select aria-label="Audio format" value={audioDraft.format} onChange={(event) => setAudioDraft({ ...audioDraft, format: event.target.value })}><option value="m4a">M4A / AAC</option><option value="opus">Opus</option><option value="flac">FLAC</option></select></label>
                    <label>Bitrate<select aria-label="Audio bitrate" disabled={audioDraft.format === "flac"} value={audioDraft.bitrate} onChange={(event) => setAudioDraft({ ...audioDraft, bitrate: event.target.value })}><option value="128">128 kbps</option><option value="192">192 kbps</option><option value="256">256 kbps</option><option value="320">320 kbps</option></select></label>
                  </div>
                  <button className="primary-action" disabled={extracting} type="submit">
                    {extracting ? "Queueing…" : "Create audio track"}
                  </button>
                </form>
              </details>
            ) : null}
            {statusMessage ? <p aria-live="polite" className="editorial-status">{statusMessage}</p> : null}
            {error ? <p role="alert">{error}</p> : null}
            <small className="shortcut-hint">
              Shortcuts: 1–5 rate · F favorite · ←/→ navigate · Esc close
            </small>
          </aside>
        </div>

        <footer className="viewer-footer">
          <div className="viewer-file-details">
            <strong>{file?.relative_path}</strong>
            <span>{file ? formatBytes(file.size) : "Original file"}</span>
            {asset.media_type === "video" && extension === "mkv" ? (
              <p>Brave may not play MKV directly. Download the original only when you want the file.</p>
            ) : null}
          </div>
          <div className="viewer-footer-actions">
            <button
              aria-label="Previous asset"
              disabled={!canNavigatePrevious}
              onClick={onNavigatePrevious}
              type="button"
            >
              ← Previous
            </button>
            <button
              aria-label="Next asset"
              disabled={!canNavigateNext}
              onClick={onNavigateNext}
              type="button"
            >
              Next →
            </button>
            <a download href={streamUrl}>Download original</a>
          </div>
        </footer>
      </section>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function parseTimecode(value: string): number {
  const parts = value.trim().split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) {
    throw new Error("Use a time such as 01:23 or 00:01:23");
  }
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid time range");
  return Math.round(seconds * 1000);
}

function formatDestination(value: string): string {
  const normalized = value
    .split(/[-_]+/)
    .filter(Boolean)
    .join(" ");
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Unknown";
}
