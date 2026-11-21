import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMetubePayload,
  buildTubeArchivistPayload,
  checkTargetAvailability,
  isDuplicateDownload,
  submitUrl,
  uploadImage,
} from "../src/api.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    clone: () => jsonResponse(body, status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("buildTubeArchivistPayload", () => {
  it("builds the TubeArchivist download payload", () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

    expect(buildTubeArchivistPayload(url)).toEqual({
      data: [{ youtube_id: url, status: "pending" }],
    });
  });
});

describe("buildMetubePayload", () => {
  it("uses an arbitrary configured download folder", () => {
    const payload = buildMetubePayload(
      "https://soundcloud.com/artist/track",
      { metubeFolder: "vault/videos" },
    );

    expect(payload).toEqual({
      url: "https://soundcloud.com/artist/track",
      quality: "best",
      folder: "vault/videos",
    });
  });

  it("omits the folder for a target's root downloads directory", () => {
    const payload = buildMetubePayload("https://example.test/video.mp4", {
      metubeFolder: "",
    });

    expect(payload).not.toHaveProperty("folder");
  });

  it("preserves functional and signed URL query parameters", () => {
    expect(
      buildMetubePayload("https://www.youtube.com/watch?v=abc123&utm_source=test")
        .url,
    ).toBe("https://www.youtube.com/watch?v=abc123");
    expect(
      buildMetubePayload(
        "https://cdn.example.test/video.mp4?token=secret&expires=123",
      ).url,
    ).toBe(
      "https://cdn.example.test/video.mp4?token=secret&expires=123",
    );
  });
});

describe("isDuplicateDownload", () => {
  const history = {
    done: [
      { url: "https://example.test/video?id=1", folder: "" },
      { url: "https://example.test/other?id=2", folder: "vault/videos" },
    ],
    queue: [],
    pending: [],
  };

  it("deduplicates within the configured target folder only", () => {
    expect(
      isDuplicateDownload(history, "https://example.test/video?id=1", ""),
    ).toBe(true);
    expect(
      isDuplicateDownload(
        history,
        "https://example.test/video?id=1",
        "vault/videos",
      ),
    ).toBe(false);
  });

  it("deduplicates a Twitch clip across its short and redirected URLs", () => {
    const twitchHistory = {
      done: [
        {
          url: "https://clips.twitch.tv/FaintLightGullWholeWheat?source=share",
          folder: "secondary/archive",
        },
      ],
      queue: [],
      pending: [],
    };

    expect(
      isDuplicateDownload(
        twitchHistory,
        "https://www.twitch.tv/ea/clip/FaintLightGullWholeWheat?range=all",
        "secondary/archive",
      ),
    ).toBe(true);
  });

  it("allows a failed download to be retried", () => {
    const failedHistory = {
      done: [
        {
          url: "https://www.youtube.com/watch?v=retry-me",
          folder: "",
          status: "error",
        },
      ],
      queue: [],
      pending: [],
    };

    expect(
      isDuplicateDownload(
        failedHistory,
        "https://www.youtube.com/watch?v=retry-me",
        "",
      ),
    ).toBe(false);
  });
});

describe("checkTargetAvailability", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("skips the preflight when the target has no availability id", async () => {
    await expect(
      checkTargetAvailability({ imageApiUrl: "", availabilityId: "" }),
    ).resolves.toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("matches an arbitrary destination id from the catalog API", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        destinations: [
          { id: "primary", available: true },
          { id: "offsite", available: false },
        ],
      }),
    });

    await expect(
      checkTargetAvailability({
        imageApiUrl: "https://catalog.example.test",
        availabilityId: "offsite",
      }),
    ).resolves.toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://catalog.example.test/destinations",
    );
  });
});

describe("submitUrl", () => {
  beforeEach(() => {
    globalThis.chrome = {
      cookies: { getAll: vi.fn(async () => []) },
      storage: {
        local: {
          get: vi.fn(async () => ({
            activeTargetId: "archive",
            targets: [
              {
                id: "archive",
                name: "Archive",
                metubeUrl: "https://downloads.example.test",
              },
            ],
          })),
          set: vi.fn(async () => {}),
        },
      },
    };
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith("/history")) {
        return jsonResponse({ done: [], queue: [], pending: [] });
      }
      if (url.endsWith("/add")) {
        return jsonResponse({
          status: "error",
          msg: "Downloader rejected the URL",
        });
      }
      return jsonResponse({ status: "ok" });
    });
  });

  it("reports a downloader error returned in a successful HTTP response", async () => {
    await expect(
      submitUrl("https://media.example.test/video.mp4"),
    ).resolves.toEqual({
      ok: false,
      error: "MeTube: Downloader rejected the URL",
    });
  });
});

describe("uploadImage", () => {
  beforeEach(() => {
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({
            activeTargetId: "offsite",
            targets: [
              {
                id: "offsite",
                name: "Offsite",
                imageApiUrl: "https://catalog.example.test",
                imageDestination: "offsite-images",
              },
            ],
          })),
          set: vi.fn(async () => {}),
        },
      },
    };
    globalThis.fetch = vi.fn(async () => ({ ok: true }));
  });

  it("uploads to the active target's API and destination key", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith("/upload")) {
        return jsonResponse({
          asset_id: "asset-123",
          status: "saved",
          asset_url: "/api/assets/asset-123",
        }, 201);
      }
      return jsonResponse({ destinations: [] });
    });

    const result = await uploadImage(new Blob(["image"]), "image.png", {
      sourceUrl: "https://example.test/image.png",
      pageUrl: "https://example.test/article",
      pageTitle: "Example",
    });

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://catalog.example.test/upload");
    expect(options.body.get("destination")).toBe("offsite-images");
    expect(options.body.get("page_url")).toBe("https://example.test/article");
    expect(result).toEqual({
      ok: true,
      assetId: "asset-123",
      status: "saved",
      assetUrl: "/api/assets/asset-123",
    });
  });

  it("returns duplicate status and a safe API error", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith("/upload")) {
        return jsonResponse({
          asset_id: "existing-1",
          status: "duplicate",
          asset_url: "/api/assets/existing-1",
        });
      }
      return jsonResponse({ destinations: [] });
    });

    await expect(uploadImage(new Blob(["image"]), "same.png", {})).resolves.toEqual({
      ok: true,
      assetId: "existing-1",
      status: "duplicate",
      assetUrl: "/api/assets/existing-1",
    });

    globalThis.fetch = vi.fn(async () => jsonResponse({ detail: "Image destination is unavailable" }, 503));
    await expect(uploadImage(new Blob(["image"]), "same.png", {})).resolves.toEqual({
      ok: false,
      error: "Image destination is unavailable",
    });
  });
});
