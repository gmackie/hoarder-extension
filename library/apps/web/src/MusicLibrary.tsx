import { type FormEvent, useCallback, useEffect, useState } from "react";

export type MusicTrack = {
  id: string;
  title: string;
  artist: { id: string; name: string } | null;
  release: { id: string; title: string; year: number | null } | null;
  track_number: number | null;
  genre: string;
  tags: string[];
  source_asset: { id: string; title: string };
  start_ms: number;
  end_ms: number | null;
  format: string;
  codec: string | null;
  size: number | null;
  duration_ms: number | null;
  sample_rate: number | null;
  channels: number | null;
  relative_path: string;
  stream_url: string;
  artwork_url: string | null;
  created_at: string;
};

type ArtistSummary = { id: string; name: string; track_count: number };
type ReleaseSummary = {
  id: string;
  title: string;
  year: number | null;
  artist: { id: string; name: string } | null;
  track_count: number;
};

type MusicLibraryProps = {
  apiBase: string;
  onViewSource: (assetId: string) => void;
};

const PAGE_SIZE = 50;

export function MusicLibrary({ apiBase, onViewSource }: MusicLibraryProps) {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [queryDraft, setQueryDraft] = useState("");
  const [artistDraft, setArtistDraft] = useState("");
  const [releaseDraft, setReleaseDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [filters, setFilters] = useState({ q: "", artist: "", release: "", tag: "" });
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<MusicTrack | null>(null);
  const [tagEditDraft, setTagEditDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMusic = useCallback(async () => {
    setLoading(true);
    setError(null);
    const parameters = new URLSearchParams({ limit: String(PAGE_SIZE), offset: "0" });
    for (const [key, value] of Object.entries(filters)) {
      if (value) parameters.set(key, value);
    }
    try {
      const [trackResponse, artistResponse, releaseResponse] = await Promise.all([
        fetch(`${apiBase}/api/music/tracks?${parameters}`),
        fetch(`${apiBase}/api/music/artists`),
        fetch(`${apiBase}/api/music/releases`),
      ]);
      if (!trackResponse.ok || !artistResponse.ok || !releaseResponse.ok) {
        throw new Error("Music catalog request failed");
      }
      const [trackPayload, artistPayload, releasePayload] = await Promise.all([
        trackResponse.json() as Promise<{ items: MusicTrack[] }>,
        artistResponse.json() as Promise<{ items: ArtistSummary[] }>,
        releaseResponse.json() as Promise<{ items: ReleaseSummary[] }>,
      ]);
      setTracks(trackPayload.items);
      setArtists(artistPayload.items);
      setReleases(releasePayload.items);
      setSelectedId((current) => (
        trackPayload.items.some((item) => item.id === current)
          ? current
          : trackPayload.items[0]?.id ?? null
      ));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Music catalog request failed");
    } finally {
      setLoading(false);
    }
  }, [apiBase, filters]);

  useEffect(() => {
    void loadMusic();
  }, [loadMusic]);

  const selected = tracks.find((item) => item.id === selectedId) ?? null;

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({
      q: queryDraft.trim(),
      artist: artistDraft,
      release: releaseDraft,
      tag: tagDraft.trim(),
    });
  }

  function beginEditing() {
    if (!selected) return;
    setEditDraft(selected);
    setTagEditDraft(selected.tags.join(", "));
    setEditing(true);
    setStatus(null);
  }

  async function saveTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editDraft) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: editDraft.title,
        artist: editDraft.artist?.name ?? "",
        release: editDraft.release?.title ?? "",
        year: editDraft.release?.year ?? null,
        track_number: editDraft.track_number ?? null,
        genre: editDraft.genre,
        tags: tagEditDraft.split(",").map((tag) => tag.trim()).filter(Boolean),
      };
      const response = await fetch(`${apiBase}/api/music/tracks/${editDraft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`Track save failed (${response.status})`);
      const saved = await response.json() as MusicTrack;
      setTracks((current) => current.map((item) => item.id === saved.id ? saved : item));
      setEditDraft(saved);
      setEditing(false);
      setStatus("Track metadata saved");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Track save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTrack() {
    if (!selected) return;
    if (!window.confirm(
      `Delete the generated audio for “${selected.title}”? The source video will not be changed.`,
    )) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/music/tracks/${selected.id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(`Track delete failed (${response.status})`);
      const remaining = tracks.filter((item) => item.id !== selected.id);
      setTracks(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      setStatus("Generated audio deleted; source preserved");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Track delete failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Music library" className="music-library">
      <form className="music-toolbar" onSubmit={applyFilters} role="search">
        <input
          aria-label="Search music"
          onChange={(event) => setQueryDraft(event.target.value)}
          placeholder="Search tracks, artists, releases…"
          type="search"
          value={queryDraft}
        />
        <select
          aria-label="Artist filter"
          onChange={(event) => setArtistDraft(event.target.value)}
          value={artistDraft}
        >
          <option value="">All artists</option>
          {artists.map((artist) => (
            <option key={artist.id} value={artist.name}>{artist.name} ({artist.track_count})</option>
          ))}
        </select>
        <select
          aria-label="Release filter"
          onChange={(event) => setReleaseDraft(event.target.value)}
          value={releaseDraft}
        >
          <option value="">All releases</option>
          {releases.map((release) => (
            <option key={release.id} value={release.title}>{release.title} ({release.track_count})</option>
          ))}
        </select>
        <input
          aria-label="Music tag filter"
          onChange={(event) => setTagDraft(event.target.value)}
          placeholder="Tag"
          value={tagDraft}
        />
        <button type="submit">Apply</button>
        <button
          className="secondary-action"
          onClick={() => {
            setQueryDraft(""); setArtistDraft(""); setReleaseDraft(""); setTagDraft("");
            setFilters({ q: "", artist: "", release: "", tag: "" });
          }}
          type="button"
        >
          Reset
        </button>
      </form>

      {error ? <p role="alert">{error}</p> : null}
      {status ? <p aria-live="polite" className="scan-status">{status}</p> : null}
      <div className="music-workspace">
        <div className="track-list" role="list" aria-label="Tracks">
          {tracks.map((item) => (
            <button
              aria-current={item.id === selectedId ? "true" : undefined}
              className="track-row"
              key={item.id}
              onClick={() => { setSelectedId(item.id); setEditing(false); setStatus(null); }}
              role="listitem"
              type="button"
            >
              <span className="track-number">{item.track_number ?? "♪"}</span>
              <span><strong>{item.title}</strong><small>{item.artist?.name ?? "Unknown artist"}</small></span>
              <span><small>{formatDuration(item.duration_ms)}</small></span>
            </button>
          ))}
          {tracks.length === 0 ? (
            <div className="empty-state">
              <strong>{loading ? "Loading music…" : "No extracted tracks found"}</strong>
              <span>Open a video and create an audio track to begin the music catalog.</span>
            </div>
          ) : null}
        </div>

        {selected ? (
          <article className="track-detail">
            <div className="album-art">
              {selected.artwork_url ? (
                <img
                  alt={`Artwork for ${selected.title}`}
                  onError={(event) => { event.currentTarget.hidden = true; }}
                  src={`${apiBase}${selected.artwork_url}`}
                />
              ) : <span aria-hidden="true">♪</span>}
            </div>
            <div className="track-detail-heading">
              <span>{selected.genre || "Uncategorized"}</span>
              <h2>{selected.title}</h2>
              <p>{selected.artist?.name ?? "Unknown artist"}</p>
              {selected.release ? (
                <p>{selected.release.title}{selected.release.year ? ` · ${selected.release.year}` : ""}</p>
              ) : null}
            </div>
            <audio controls preload="metadata" src={`${apiBase}${selected.stream_url}`} />
            <div className="track-tags">
              {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <dl className="track-facts">
              <div><dt>Format</dt><dd>{selected.format.toUpperCase()} · {selected.codec ?? "unknown"}</dd></div>
              <div><dt>Audio</dt><dd>{selected.sample_rate ? `${selected.sample_rate / 1000} kHz` : "—"} · {selected.channels ?? "—"} ch</dd></div>
              <div><dt>Range</dt><dd>{formatTime(selected.start_ms)}–{selected.end_ms ? formatTime(selected.end_ms) : "end"}</dd></div>
              <div><dt>Size</dt><dd>{formatBytes(selected.size)}</dd></div>
            </dl>
            <button
              className="source-lineage"
              onClick={() => onViewSource(selected.source_asset.id)}
              type="button"
              aria-label={`Open source ${selected.source_asset.title}`}
            >
              Extracted from {selected.source_asset.title} · open source video
            </button>
            <div className="track-actions">
              <button aria-label={`Edit ${selected.title}`} onClick={beginEditing} type="button">Edit metadata</button>
              <button
                aria-label={`Delete ${selected.title}`}
                className="danger-action"
                disabled={saving}
                onClick={() => void deleteTrack()}
                type="button"
              >
                Delete generated audio
              </button>
            </div>
            {editing && editDraft ? (
              <form className="track-editor" onSubmit={saveTrack}>
                <label>Track title<input aria-label="Track title" required value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} /></label>
                <label>Artist<input value={editDraft.artist?.name ?? ""} onChange={(event) => setEditDraft({ ...editDraft, artist: { id: editDraft.artist?.id ?? "", name: event.target.value } })} /></label>
                <label>Release<input value={editDraft.release?.title ?? ""} onChange={(event) => setEditDraft({ ...editDraft, release: { id: editDraft.release?.id ?? "", title: event.target.value, year: editDraft.release?.year ?? null } })} /></label>
                <label>Year<input min="1000" max="9999" type="number" value={editDraft.release?.year ?? ""} onChange={(event) => setEditDraft({ ...editDraft, release: { id: editDraft.release?.id ?? "", title: editDraft.release?.title ?? "", year: event.target.value ? Number(event.target.value) : null } })} /></label>
                <label>Track number<input min="1" type="number" value={editDraft.track_number ?? ""} onChange={(event) => setEditDraft({ ...editDraft, track_number: event.target.value ? Number(event.target.value) : null })} /></label>
                <label>Genre<input value={editDraft.genre} onChange={(event) => setEditDraft({ ...editDraft, genre: event.target.value })} /></label>
                <label className="wide-field">Tags<input aria-label="Track tags" value={tagEditDraft} onChange={(event) => setTagEditDraft(event.target.value)} /></label>
                <div className="wide-field track-actions">
                  <button className="primary-action" disabled={saving} type="submit">Save track</button>
                  <button onClick={() => setEditing(false)} type="button">Cancel</button>
                </div>
              </form>
            ) : null}
          </article>
        ) : null}
      </div>
    </section>
  );
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  return formatTime(value);
}

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatBytes(value: number | null) {
  if (value === null) return "—";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
