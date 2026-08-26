import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMetubePayload,
  buildTubeArchivistPayload,
  checkTargetAvailability,
  isDuplicateDownload,
  uploadImage,
} from "../src/api.js";

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
    await uploadImage(new Blob(["image"]), "image.png", {
      sourceUrl: "https://example.test/image.png",
      pageTitle: "Example",
    });

    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://catalog.example.test/upload");
    expect(options.body.get("destination")).toBe("offsite-images");
  });
});
