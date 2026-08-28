import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MusicLibrary } from "./MusicLibrary";

const track = {
  id: "track-1",
  title: "Opening Theme",
  artist: { id: "artist-1", name: "House Ensemble" },
  release: { id: "release-1", title: "Live Archive", year: 2026 },
  track_number: 1,
  genre: "Ambient",
  tags: ["live", "reference"],
  source_asset: { id: "video-1", title: "Full Concert" },
  start_ms: 100,
  end_ms: 900,
  format: "m4a",
  codec: "aac",
  size: 13099,
  duration_ms: 800,
  sample_rate: 44100,
  channels: 2,
  relative_path: "audio/video-1/hash.m4a",
  stream_url: "/api/music/tracks/track-1/stream",
  artwork_url: "/api/assets/video-1/thumbnail",
  created_at: "2026-08-27T12:00:00Z",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function catalogFetch(input: string | URL | Request, init?: RequestInit) {
  const url = String(input);
  if (url.includes("/api/music/tracks") && init?.method === "PATCH") {
    return Promise.resolve({
      ok: true,
      json: async () => ({ ...track, ...JSON.parse(String(init.body)) }),
    });
  }
  if (url.includes("/api/music/tracks")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({ items: [track], total: 1, limit: 50, offset: 0 }),
    });
  }
  if (url.endsWith("/api/music/artists")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        items: [{ id: "artist-1", name: "House Ensemble", track_count: 1 }],
        total: 1,
      }),
    });
  }
  if (url.endsWith("/api/music/releases")) {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        items: [{
          id: "release-1",
          title: "Live Archive",
          year: 2026,
          artist: track.artist,
          track_count: 1,
        }],
        total: 1,
      }),
    });
  }
  return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
}

describe("MusicLibrary", () => {
  it("browses tracks by artist and release with in-app playback and provenance", async () => {
    vi.stubGlobal("fetch", vi.fn(catalogFetch));
    const onViewSource = vi.fn();

    render(<MusicLibrary apiBase="http://catalog.test" onViewSource={onViewSource} />);

    expect(await screen.findByRole("heading", { name: "Opening Theme" })).toBeInTheDocument();
    expect(screen.getAllByText("House Ensemble").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Live Archive/).length).toBeGreaterThan(0);
    expect(screen.getByText("live")).toBeInTheDocument();
    expect(screen.getByText("reference")).toBeInTheDocument();
    expect(document.querySelector("audio")).toHaveAttribute(
      "src",
      "http://catalog.test/api/music/tracks/track-1/stream",
    );
    expect(screen.getByRole("img", { name: "Artwork for Opening Theme" })).toHaveAttribute(
      "src",
      "http://catalog.test/api/assets/video-1/thumbnail",
    );
    expect(screen.getByText(/Extracted from Full Concert/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open source Full Concert" }));
    expect(onViewSource).toHaveBeenCalledWith("video-1");
  });

  it("filters tracks by text, artist, release, and tag", async () => {
    const fetch = vi.fn(catalogFetch);
    vi.stubGlobal("fetch", fetch);
    render(<MusicLibrary apiBase="http://catalog.test" onViewSource={() => {}} />);
    await screen.findByRole("heading", { name: "Opening Theme" });

    fireEvent.change(screen.getByRole("searchbox", { name: "Search music" }), {
      target: { value: "opening" },
    });
    fireEvent.change(screen.getByLabelText("Artist filter"), {
      target: { value: "House Ensemble" },
    });
    fireEvent.change(screen.getByLabelText("Release filter"), {
      target: { value: "Live Archive" },
    });
    fireEvent.change(screen.getByLabelText("Music tag filter"), {
      target: { value: "live" },
    });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://catalog.test/api/music/tracks?limit=50&offset=0&q=opening&artist=House+Ensemble&release=Live+Archive&tag=live",
    ));
  });

  it("edits track metadata without re-extracting audio", async () => {
    const fetch = vi.fn(catalogFetch);
    vi.stubGlobal("fetch", fetch);
    render(<MusicLibrary apiBase="http://catalog.test" onViewSource={() => {}} />);
    await screen.findByRole("heading", { name: "Opening Theme" });

    fireEvent.click(screen.getByRole("button", { name: "Edit Opening Theme" }));
    fireEvent.change(screen.getByLabelText("Track title"), {
      target: { value: "Final Theme" },
    });
    fireEvent.change(screen.getByLabelText("Track tags"), {
      target: { value: "live, favorite" },
    });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Track number"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save track" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://catalog.test/api/music/tracks/track-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"title":"Final Theme"'),
      }),
    ));
    const patchCall = fetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      year: null,
      track_number: null,
    });
    expect(await screen.findByText("Track metadata saved")).toBeInTheDocument();
  });

  it("requires confirmation before deleting generated audio", async () => {
    const fetch = vi.fn(catalogFetch);
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("confirm", vi.fn(() => true));
    render(<MusicLibrary apiBase="http://catalog.test" onViewSource={() => {}} />);
    await screen.findByRole("heading", { name: "Opening Theme" });

    fireEvent.click(screen.getByRole("button", { name: "Delete Opening Theme" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://catalog.test/api/music/tracks/track-1",
      { method: "DELETE" },
    ));
  });
});
