import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
