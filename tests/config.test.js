import { beforeEach, describe, expect, it, vi } from "vitest";

describe("portable archive configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
      },
    };
  });

  it("starts without a setup-specific host or destination", async () => {
    const { getConfig } = await import("../src/config.js");

    const config = await getConfig();

    expect(config.targets).toEqual([]);
    expect(config.activeTargetId).toBe("");
    expect(config.autoSaveEnabled).toBe(false);
  });

  it("bootstraps an empty profile from an ignored local config file", async () => {
    globalThis.chrome.runtime = {
      getURL: vi.fn(() => "chrome-extension://id/local-config.json"),
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        activeTargetId: "home",
        autoSaveEnabled: true,
        targets: [
          {
            id: "home",
            name: "Home",
            metubeUrl: "http://media.internal:8081",
          },
        ],
      }),
    }));
    const { getConfig } = await import("../src/config.js");

    const config = await getConfig();

    expect(config.activeTargetId).toBe("home");
    expect(config.autoSaveEnabled).toBe(true);
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(config);
  });

  it("normalizes arbitrary user-defined targets", async () => {
    const { normalizeConfig, getActiveTarget } = await import(
      "../src/config.js"
    );
    const config = normalizeConfig({
      activeTargetId: "cold-storage",
      autoSaveEnabled: true,
      autoSaveDelaySeconds: 4,
      targets: [
        {
          id: "cold-storage",
          name: "Cold storage",
          metubeUrl: "https://downloads.example.test/",
          metubeFolder: "vault/videos",
          imageApiUrl: "https://catalog.example.test/",
          imageDestination: "vault",
        },
      ],
    });

    expect(getActiveTarget(config)).toMatchObject({
      id: "cold-storage",
      metubeUrl: "https://downloads.example.test",
      metubeFolder: "vault/videos",
      imageApiUrl: "https://catalog.example.test",
      imageDestination: "vault",
    });
    expect(config.autoSaveEnabled).toBe(true);
    expect(config.autoSaveDelaySeconds).toBe(4);
  });

  it("migrates the previously stored single-NAS schema", async () => {
    globalThis.chrome.storage.local.get.mockResolvedValue({
      nasBaseUrl: "http://archive-box",
      destination: "cold-storage",
      metubePort: 8081,
      imageApiPort: 8082,
      tubeArchivistPort: 8000,
      taApiKey: "legacy-key",
      autoDetect: true,
    });
    const { getConfig, getActiveTarget } = await import("../src/config.js");

    const config = await getConfig();
    const target = getActiveTarget(config);

    expect(target).toMatchObject({
      id: "cold-storage",
      name: "Cold Storage",
      metubeUrl: "http://archive-box:8081",
      imageApiUrl: "http://archive-box:8082",
      imageDestination: "cold-storage",
    });
    expect(config.autoSaveEnabled).toBe(true);
    expect(globalThis.chrome.storage.local.set).toHaveBeenCalledWith(config);
  });

  it("routes YouTube according to each target's capabilities", async () => {
    const { getTargetService } = await import("../src/config.js");
    const youtube = "https://www.youtube.com/watch?v=abc123";

    expect(
      getTargetService(youtube, {
        metubeUrl: "http://media:8081",
        tubeArchivistUrl: "http://media:8000",
        useTubeArchivistForYouTube: true,
      }),
    ).toBe("tubearchivist");
    expect(
      getTargetService(youtube, {
        metubeUrl: "http://media:8081",
        tubeArchivistUrl: "http://media:8000",
        useTubeArchivistForYouTube: false,
      }),
    ).toBe("metube");
  });
});
