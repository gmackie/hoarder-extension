import { describe, expect, it } from "vitest";
import { findDownloadableVideo } from "../src/detection.js";
import { shouldAutoSave } from "../src/autosave.js";

describe("findDownloadableVideo", () => {
  it("recognizes specific video pages, not platform home pages", () => {
    expect(
      findDownloadableVideo("https://www.youtube.com/watch?v=abc123"),
    ).toBe("https://www.youtube.com/watch?v=abc123");
    expect(findDownloadableVideo("https://www.youtube.com/")).toBeNull();
    expect(
      findDownloadableVideo("https://www.twitch.tv/videos/123456"),
    ).toBe("https://www.twitch.tv/videos/123456");
  });

  it("recognizes direct video URLs", () => {
    expect(
      findDownloadableVideo("https://cdn.example.test/media/movie.mp4?token=abc"),
    ).toBe("https://cdn.example.test/media/movie.mp4?token=abc");
  });

  it("uses a direct HTML5 video source on an otherwise unknown page", () => {
    expect(
      findDownloadableVideo("https://example.test/article", [
        "blob:https://example.test/player",
        "https://cdn.example.test/video.webm",
      ]),
    ).toBe("https://cdn.example.test/video.webm");
  });

  it("ignores ordinary pages and blob-only players", () => {
    expect(findDownloadableVideo("https://example.test/article")).toBeNull();
    expect(
      findDownloadableVideo("https://example.test/article", [
        "blob:https://example.test/player",
      ]),
    ).toBeNull();
  });
});

describe("shouldAutoSave", () => {
  const candidate = "https://cdn.example.test/movie.mp4";

  it("requires both opt-in and a configured active target", () => {
    expect(
      shouldAutoSave(
        {
          autoSaveEnabled: true,
          activeTargetId: "archive",
          targets: [{ id: "archive" }],
        },
        candidate,
      ),
    ).toBe(true);
    expect(
      shouldAutoSave(
        {
          autoSaveEnabled: false,
          activeTargetId: "archive",
          targets: [{ id: "archive" }],
        },
        candidate,
      ),
    ).toBe(false);
    expect(
      shouldAutoSave(
        { autoSaveEnabled: true, activeTargetId: "", targets: [] },
        candidate,
      ),
    ).toBe(false);
  });
});
