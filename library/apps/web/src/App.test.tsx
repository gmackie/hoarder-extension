import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

afterEach(() => {
  cleanup();
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
      "http://catalog.test/api/assets?media_type=video",
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
        json: async () => ({ discovered: 2, job_id: "job-2" }),
      });
    vi.stubGlobal("fetch", fetch);
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Scan storage" }));

    expect(await screen.findByText("Scan complete: 2 discovered")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("http://catalog.test/api/scans", {
      method: "POST",
    });
  });

  it("refreshes the active catalog after a scan", async () => {
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
          json: async () => ({ discovered: 1, job_id: "job-3" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            items: [
              {
                id: "new-asset",
                title: "New media",
                media_type: "video",
                status: "available",
                files: [{ id: 3, relative_path: "New media.mp4", size: 1024 }],
              },
            ],
            total: 1,
          }),
        }),
    );
    render(<App apiBase="http://catalog.test" />);

    fireEvent.click(screen.getByRole("button", { name: "Scan storage" }));

    expect(await screen.findByText("New media")).toBeInTheDocument();
  });
});
