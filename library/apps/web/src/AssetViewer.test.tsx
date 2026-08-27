import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssetViewer, type Asset } from "./AssetViewer";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const video: Asset = {
  id: "video-1",
  title: "Museum Tour",
  media_type: "video",
  status: "available",
  thumbnail_url: "/api/assets/video-1/thumbnail",
  files: [{ id: 1, relative_path: "Museum Tour.mkv", size: 2048 }],
};

describe("AssetViewer", () => {
  it("keeps video inspection in the app and makes downloading explicit", () => {
    const onClose = vi.fn();
    render(<AssetViewer apiBase="http://catalog.test" asset={video} onClose={onClose} />);

    expect(screen.getByRole("dialog", { name: "Museum Tour" })).toBeInTheDocument();
    expect(document.querySelector("video")).toHaveAttribute(
      "src",
      "http://catalog.test/api/assets/video-1/stream",
    );
    expect(document.querySelector("video")).toHaveAttribute(
      "poster",
      "http://catalog.test/api/assets/video-1/thumbnail",
    );
    expect(screen.getByRole("link", { name: "Download original" })).toHaveAttribute(
      "download",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close viewer" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders saved images as the primary content", () => {
    const image: Asset = {
      ...video,
      id: "image-1",
      title: "Saved reference",
      media_type: "image",
      files: [{ id: 2, relative_path: "Saved reference.png", size: 1024 }],
    };

    render(<AssetViewer apiBase="" asset={image} onClose={() => {}} />);

    expect(screen.getByRole("img", { name: "Saved reference" })).toHaveAttribute(
      "src",
      "/api/assets/image-1/stream",
    );
  });

  it("edits evaluation metadata and assigns the asset to a curated channel", async () => {
    const onNext = vi.fn();
    const onEditorialSaved = vi.fn();
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/assets/video-1/editorial") && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body));
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...payload, asset_id: "video-1", tags: ["history", "museum"] }),
        });
      }
      if (url.endsWith("/api/assets/video-1/editorial")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            asset_id: "video-1",
            rating: 2,
            favorite: false,
            workflow_state: "inbox",
            notes: "",
            tags: [],
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
                description: "",
                item_count: 0,
              },
            ],
            total: 1,
          }),
        });
      }
      if (url.endsWith("/api/curated-channels/channel-1/items")) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetch);
    render(
      <AssetViewer
        apiBase="http://catalog.test"
        asset={video}
        canNavigateNext
        onClose={() => {}}
        onEditorialSaved={onEditorialSaved}
        onNavigateNext={onNext}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "4 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Favorite" }));
    fireEvent.change(screen.getByLabelText("Workflow state"), {
      target: { value: "reviewed" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Keep for a history channel." },
    });
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "history, museum" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save evaluation" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://catalog.test/api/assets/video-1/editorial",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating: 4,
            favorite: true,
            workflow_state: "reviewed",
            notes: "Keep for a history channel.",
            tags: ["history", "museum"],
          }),
        },
      );
    });
    expect(onEditorialSaved).toHaveBeenCalledWith(expect.objectContaining({
      asset_id: "video-1",
      rating: 4,
      tags: ["history", "museum"],
    }));

    fireEvent.click(screen.getByRole("button", { name: "Save and next" }));
    await waitFor(() => expect(onNext).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByLabelText("Curated channel"), {
      target: { value: "channel-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to channel" }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "http://catalog.test/api/curated-channels/channel-1/items",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ asset_id: "video-1", status: "candidate" }),
        },
      );
    });
    expect(await screen.findByText("Added to Museum Television")).toBeInTheDocument();
  });

  it("navigates the current review queue with buttons and arrow keys", () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    render(
      <AssetViewer
        apiBase=""
        asset={video}
        canNavigateNext
        canNavigatePrevious
        onClose={() => {}}
        onNavigateNext={onNext}
        onNavigatePrevious={onPrevious}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Next asset" }));
    fireEvent.keyDown(window, { key: "ArrowLeft" });

    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
  });

  it("queues a tagged audio extraction from a selected video range", async () => {
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/audio-extractions")) {
        return Promise.resolve({
          ok: true,
          status: 202,
          json: async () => ({ job_id: "job-1", status: "queued" }),
        });
      }
      if (url.endsWith("/editorial")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ asset_id: "video-1", ...{
            rating: null, favorite: false, workflow_state: "inbox", notes: "", tags: [],
          } }),
        });
      }
      if (url.endsWith("/api/curated-channels")) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetch);
    render(<AssetViewer apiBase="http://catalog.test" asset={video} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Track title"), {
      target: { value: "Museum Theme" },
    });
    fireEvent.change(screen.getByLabelText("Artist"), {
      target: { value: "Archive Orchestra" },
    });
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "00:00:10" },
    });
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "00:01:15" },
    });
    fireEvent.change(screen.getByLabelText("Audio tags"), {
      target: { value: "music, museum" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create audio track" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "http://catalog.test/api/assets/video-1/audio-extractions",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"start_ms":10000'),
      }),
    ));
    expect(await screen.findByText("Audio extraction queued — follow it in Jobs")).toBeInTheDocument();
  });
});
