import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Hoarder Library navigation", () => {
  it("offers every v1 library lens", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(<App apiBase="" />);

    for (const label of [
      "Inbox",
      "Videos",
      "Music",
      "Images",
      "Source Channels",
      "Curated Channels",
      "Jobs",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("loads the selected video lens from the catalog API", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "asset-1",
            title: "Museum Tour",
            media_type: "video",
            status: "available",
            files: [{ id: 1, relative_path: "Museum Tour.mp4", size: 2048 }],
          },
        ],
        total: 1,
      }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));

    expect(await screen.findByText("Museum Tour")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "http://catalog.test/api/assets?media_type=video&limit=50&offset=0",
    );
    await waitFor(() => {
      expect(document.querySelector(".asset-preview video")).toHaveAttribute(
        "src",
        "http://catalog.test/api/assets/asset-1/stream#t=0.1",
      );
    });
  });

  it("does not let a slow prior catalog request replace the active lens", async () => {
    let resolveInbox: ((value: unknown) => void) | undefined;
    let resolveVideos: ((value: unknown) => void) | undefined;
    const inboxResponse = new Promise((resolve) => { resolveInbox = resolve; });
    const videoResponse = new Promise((resolve) => { resolveVideos = resolve; });
    const fetch = vi.fn((input: string | URL | Request) => (
      String(input).includes("media_type=video") ? videoResponse : inboxResponse
    ));
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    resolveVideos?.({
      ok: true,
      json: async () => ({
        items: [{
          id: "active-video",
          title: "Active video result",
          media_type: "video",
          status: "available",
          files: [],
        }],
        total: 1,
      }),
    });
    expect(await screen.findByText("Active video result")).toBeInTheDocument();

    await act(async () => {
      resolveInbox?.({
        ok: true,
        json: async () => ({
          items: [{
            id: "stale-image",
            title: "Stale inbox result",
            media_type: "image",
            status: "available",
            files: [],
          }],
          total: 1,
        }),
      });
      await inboxResponse;
    });

    expect(screen.queryByText("Stale inbox result")).not.toBeInTheDocument();
    expect(screen.getByText("Active video result")).toBeInTheDocument();
  });

  it("walks forward and backward through the visible review queue", async () => {
    const assets = [
      {
        id: "asset-1",
        title: "First Film",
        media_type: "video",
        status: "available",
        files: [{ id: 1, relative_path: "First Film.mp4", size: 2048 }],
      },
      {
        id: "asset-2",
        title: "Second Film",
        media_type: "video",
        status: "available",
        files: [{ id: 2, relative_path: "Second Film.mp4", size: 2048 }],
      },
    ];
    const fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      const editorialMatch = url.match(/\/api\/assets\/(asset-[12])\/editorial$/);
      if (editorialMatch) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            asset_id: editorialMatch[1],
            rating: null,
            favorite: false,
            workflow_state: "inbox",
            notes: "",
            tags: [],
          }),
        });
      }
      if (url.endsWith("/api/curated-channels")) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 0 }) });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: assets, total: assets.length }),
      });
    });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(await screen.findByRole("button", { name: "View First Film" }));
    expect(screen.getByRole("dialog", { name: "First Film" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next asset" }));
    expect(await screen.findByRole("dialog", { name: "Second Film" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous asset" }));
    expect(await screen.findByRole("dialog", { name: "First Film" })).toBeInTheDocument();
  });

  it("uses associated video artwork without listing it as an image asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "video-1",
              title: "Museum Tour",
              media_type: "video",
              status: "available",
              thumbnail_url: "/api/assets/video-1/thumbnail",
              files: [{ id: 1, relative_path: "youtube/channel/video-1.mp4", size: 2048 }],
            },
          ],
          total: 1,
        }),
      }),
    );

    render(<App apiBase="http://catalog.test" />);

    expect(await screen.findByText("Museum Tour")).toBeInTheDocument();
    expect(document.querySelector(".asset-preview img")).toHaveAttribute(
      "src",
      "http://catalog.test/api/assets/video-1/thumbnail",
    );
  });

  it("can page into older videos and render their associated thumbnails", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], total: 51, limit: 50, offset: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "older-video",
              title: "Older archived video",
              media_type: "video",
              status: "available",
              thumbnail_url: "/api/assets/older-video/thumbnail",
              files: [{ id: 2, relative_path: "youtube/channel/older-video.mp4", size: 4096 }],
            },
          ],
          total: 51,
          limit: 50,
          offset: 50,
        }),
      });
    vi.stubGlobal("fetch", fetch);

    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(await screen.findByRole("button", { name: "Older" }));

    expect(await screen.findByText("Older archived video")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      "http://catalog.test/api/assets?limit=50&offset=50",
    );
    expect(document.querySelector(".asset-preview img")).toHaveAttribute(
      "src",
      "http://catalog.test/api/assets/older-video/thumbnail",
    );
    expect(screen.getByText("51–51 of 51")).toBeInTheDocument();
  });

  it("searches within the active library lens", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.change(await screen.findByRole("searchbox", { name: "Search library" }), {
      target: { value: "museum" },
    });
    fireEvent.submit(screen.getByRole("search"));

    expect(fetch).toHaveBeenLastCalledWith(
      "http://catalog.test/api/assets?limit=50&offset=0&q=museum",
    );
  });

  it("filters the catalog by workflow, favorites, and normalized tag", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Videos" }));
    fireEvent.change(await screen.findByLabelText("Workflow filter"), {
      target: { value: "candidate" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Favorites only" }));
    fireEvent.change(screen.getByLabelText("Tag filter"), {
      target: { value: "History" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith(
        "http://catalog.test/api/assets?media_type=video&limit=50&offset=0&favorite=true&workflow_state=candidate&tag=History",
      );
    });
  });

  it("browses source channels and opens a channel-filtered video catalog", async () => {
    const fetch = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/channels/UC-one/assets")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                id: "video-1",
                title: "Channel video",
                media_type: "video",
                status: "available",
                files: [{ id: 1, relative_path: "youtube/UC-one/video-1.mp4", size: 2048 }],
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          }),
        });
      }
      if (url.includes("/api/channels?")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                id: "UC-one",
                title: "First Source",
                video_count: 12,
                audio_count: 1,
                total_count: 13,
                subscribers: 1200,
                thumbnail_url: "/api/channels/UC-one/thumbnail",
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
      });
    });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Source Channels" }));

    expect(await screen.findByText("First Source")).toBeInTheDocument();
    expect(screen.getByText("12 videos · 1 audio")).toBeInTheDocument();
    expect(document.querySelector(".channel-card img")).toHaveAttribute(
      "src",
      "http://catalog.test/api/channels/UC-one/thumbnail",
    );

    fireEvent.click(screen.getByRole("button", { name: "Browse First Source" }));

    expect(await screen.findByRole("heading", { name: "First Source" })).toBeInTheDocument();
    expect(await screen.findByText("Channel video")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(
      "http://catalog.test/api/channels/UC-one/assets?media_type=video&limit=50&offset=0",
    );
    expect(screen.getByRole("button", { name: "All source channels" })).toBeInTheDocument();
  });

  it("creates, opens, reorders, and updates a curated channel", async () => {
    let reordered = false;
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/curated-channels") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "channel-2",
            name: "New Channel",
            description: "Fresh collection",
            item_count: 0,
          }),
        });
      }
      if (url.endsWith("/api/curated-channels")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                id: "channel-1",
                name: "Museum Television",
                description: "Always-on museum material",
                item_count: 2,
              },
            ],
            total: 1,
          }),
        });
      }
      if (url.endsWith("/api/curated-channels/channel-1/items") && !init) {
        const items = [
          {
            asset_id: reordered ? "video-2" : "video-1",
            position: 0,
            status: "candidate",
            asset: {
              id: reordered ? "video-2" : "video-1",
              title: reordered ? "Second Film" : "First Film",
              media_type: "video",
              status: "available",
              files: [],
            },
          },
          {
            asset_id: reordered ? "video-1" : "video-2",
            position: 1,
            status: "reviewed",
            asset: {
              id: reordered ? "video-1" : "video-2",
              title: reordered ? "First Film" : "Second Film",
              media_type: "video",
              status: "available",
              files: [],
            },
          },
        ];
        return Promise.resolve({
          ok: true,
          json: async () => ({ items, total: 2 }),
        });
      }
      if (url.includes("/items/video-2") && init?.method === "PATCH") {
        reordered = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({ position: 0, status: "reviewed" }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [], total: 0 }),
      });
    });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Curated Channels" }));
    fireEvent.change(await screen.findByLabelText("Channel name"), {
      target: { value: "New Channel" },
    });
    fireEvent.change(screen.getByLabelText("Channel description"), {
      target: { value: "Fresh collection" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create channel" }));

    expect(await screen.findByText("New Channel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Museum Television" }));
    expect(await screen.findByText("First Film")).toBeInTheDocument();
    expect(screen.getByText("Second Film")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move Second Film up" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://catalog.test/api/curated-channels/channel-1/items/video-2",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: 0 }),
        },
      );
    });
    expect(await screen.findByText("Order saved")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete channel" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete channel" }));
    expect(screen.getByRole("button", { name: "Confirm delete channel" })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Confirm delete channel" }));
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://catalog.test/api/curated-channels/channel-1",
        { method: "DELETE" },
      );
    });
  });

  it("shows storage scan progress in the Jobs lens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: [
            {
              id: "job-1",
              kind: "storage_scan",
              status: "completed",
              result: { discovered: 7 },
              created_at: "2026-08-27T17:00:00Z",
            },
          ],
          total: 1,
        }),
      }),
    );
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));

    expect(await screen.findByText("Storage scan")).toBeInTheDocument();
    expect(screen.getByText("7 discovered")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("refreshes the Jobs lens while it is open", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], total: 0 }),
    });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Jobs" }));
    await vi.advanceTimersByTimeAsync(2_000);

    const jobRequests = fetch.mock.calls.filter(
      ([url]) => url === "http://catalog.test/api/jobs",
    );
    expect(jobRequests).toHaveLength(2);
  });

  it("uses the Inbox as the unfiltered catalog landing view", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "image-1",
            title: "Saved reference",
            media_type: "image",
            status: "available",
            files: [{ id: 1, relative_path: "Saved reference.png", size: 512 }],
          },
        ],
        total: 1,
      }),
    });
    vi.stubGlobal("fetch", fetch);

    render(<App apiBase="http://catalog.test" />);

    expect(await screen.findByText("Saved reference")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "http://catalog.test/api/assets?limit=50&offset=0",
    );
  });

  it("can start a storage scan from the browser", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], total: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "queued", job_id: "job-2" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [], total: 0 }),
      });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Scan storage" }));

    expect(await screen.findByText("Scan queued — follow progress in Jobs")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("http://catalog.test/api/scans", {
      method: "POST",
    });
  });

  it("opens the job monitor after queuing a scan", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [], total: 0 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ status: "queued", job_id: "job-3" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                id: "job-3",
                kind: "storage_scan",
                status: "running",
                result: null,
                created_at: "2026-08-27T17:00:00Z",
              },
            ],
            total: 1,
          }),
        }),
    );
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Scan storage" }));

    expect(await screen.findByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(await screen.findByText("Storage scan")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
  });
});
