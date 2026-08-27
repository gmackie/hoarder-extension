import { beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    clone: () => jsonResponse(body, status),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("extension installation", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
        getManifest: vi.fn(() => ({ version: "1.0.6" })),
        getURL: vi.fn((path) => `chrome-extension://id/${path}`),
        reload: vi.fn(),
      },
      contextMenus: {
        create: vi.fn(),
        removeAll: vi.fn(async () => {}),
        onClicked: { addListener: vi.fn() },
      },
      commands: { onCommand: { addListener: vi.fn() } },
      tabs: { onUpdated: { addListener: vi.fn() } },
      action: {
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
        setIcon: vi.fn(async () => {}),
        setTitle: vi.fn(async () => {}),
      },
      alarms: {
        create: vi.fn(async () => {}),
        get: vi.fn(async () => null),
        onAlarm: { addListener: vi.fn() },
      },
    };
  });

  it("replaces legacy context menus when the extension updates", async () => {
    await import("../src/background.js");
    const installHandler =
      globalThis.chrome.runtime.onInstalled.addListener.mock.calls[0][0];

    await installHandler();

    expect(globalThis.chrome.contextMenus.removeAll).toHaveBeenCalledOnce();
    expect(globalThis.chrome.contextMenus.create).toHaveBeenCalledTimes(2);
  });

  it("reloads idle extension code after the updater replaces its files", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ version: "1.0.7" }));
    await import("../src/background.js");
    const alarmHandler =
      globalThis.chrome.alarms.onAlarm.addListener.mock.calls[0][0];

    await alarmHandler({ name: "reload-updated-extension" });

    expect(globalThis.chrome.runtime.reload).toHaveBeenCalledOnce();
  });

  it("does not postpone an existing update reload alarm", async () => {
    globalThis.chrome.alarms.get.mockResolvedValue({
      name: "reload-updated-extension",
    });

    await import("../src/background.js");
    await vi.waitFor(() =>
      expect(globalThis.chrome.alarms.get).toHaveBeenCalledWith(
        "reload-updated-extension",
      ),
    );

    expect(globalThis.chrome.alarms.create).not.toHaveBeenCalled();
  });

  it("shows saving until a manual submission is accepted", async () => {
    globalThis.chrome.storage = {
      local: {
        get: vi.fn(async () => ({
          activeTargetId: "home",
          targets: [
            {
              id: "home",
              name: "Home",
              metubeUrl: "https://downloads.example.test",
            },
          ],
        })),
        set: vi.fn(async () => {}),
      },
    };
    globalThis.chrome.cookies = { getAll: vi.fn(async () => []) };
    let acceptDownload;
    globalThis.fetch = vi.fn(async (url) => {
      if (url.startsWith("chrome-extension://")) {
        return jsonResponse({ version: "1.0.7" });
      }
      if (url.endsWith("/history")) {
        return jsonResponse({ done: [], queue: [] });
      }
      if (url.endsWith("/upload-cookies")) {
        return jsonResponse(null);
      }
      if (url.endsWith("/add")) {
        return new Promise((resolve) => {
          acceptDownload = () =>
            resolve(
              jsonResponse({ status: "ok" }),
            );
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await import("../src/background.js");
    const messageHandler =
      globalThis.chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const response = new Promise((resolve) => {
      expect(
        messageHandler(
          {
            type: "submit-url",
            url: "https://media.example.test/video.mp4",
            tabId: 17,
          },
          {},
          resolve,
        ),
      ).toBe(true);
    });

    await vi.waitFor(() => expect(acceptDownload).toBeTypeOf("function"));
    expect(globalThis.chrome.action.setIcon).toHaveBeenCalledWith({
      path: {
        16: "icons/icon-saving-16.png",
        48: "icons/icon-saving-48.png",
        128: "icons/icon-saving-128.png",
      },
      tabId: 17,
    });
    const alarmHandler =
      globalThis.chrome.alarms.onAlarm.addListener.mock.calls[0][0];
    await alarmHandler({ name: "reload-updated-extension" });
    expect(globalThis.chrome.runtime.reload).not.toHaveBeenCalled();

    acceptDownload();
    await expect(response).resolves.toEqual({ ok: true });
    expect(globalThis.chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: {
        16: "icons/icon-saved-16.png",
        48: "icons/icon-saved-48.png",
        128: "icons/icon-saved-128.png",
      },
      tabId: 17,
    });
    expect(globalThis.chrome.action.setTitle).toHaveBeenLastCalledWith({
      title: "Hoarder: saved",
      tabId: 17,
    });
    expect(globalThis.chrome.action.setBadgeText).toHaveBeenCalledWith({
      text: "",
      tabId: 17,
    });
    await alarmHandler({ name: "reload-updated-extension" });
    expect(globalThis.chrome.runtime.reload).toHaveBeenCalledOnce();
  });

  it("shows a failure icon when a submission is rejected", async () => {
    globalThis.chrome.storage = {
      local: {
        get: vi.fn(async () => ({ targets: [] })),
        set: vi.fn(async () => {}),
      },
    };
    await import("../src/background.js");
    const messageHandler =
      globalThis.chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const response = new Promise((resolve) => {
      messageHandler(
        {
          type: "submit-url",
          url: "https://media.example.test/video.mp4",
          tabId: 23,
        },
        {},
        resolve,
      );
    });

    await expect(response).resolves.toEqual({
      ok: false,
      error: "No archive target configured",
    });
    expect(globalThis.chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: {
        16: "icons/icon-failed-16.png",
        48: "icons/icon-failed-48.png",
        128: "icons/icon-failed-128.png",
      },
      tabId: 23,
    });
  });

  it("shows saving and saved states for automatic submissions", async () => {
    globalThis.chrome.storage = {
      local: {
        get: vi.fn(async () => ({
          activeTargetId: "home",
          autoSaveEnabled: true,
          autoSaveDelaySeconds: 0,
          targets: [
            {
              id: "home",
              name: "Home",
              metubeUrl: "https://downloads.example.test",
            },
          ],
        })),
        set: vi.fn(async () => {}),
      },
    };
    globalThis.chrome.cookies = { getAll: vi.fn(async () => []) };
    let acceptDownload;
    globalThis.fetch = vi.fn(async (url) => {
      if (url.endsWith("/history")) {
        return jsonResponse({ done: [], queue: [] });
      }
      if (url.endsWith("/upload-cookies")) {
        return jsonResponse(null);
      }
      if (url.endsWith("/add")) {
        return new Promise((resolve) => {
          acceptDownload = () =>
            resolve(
              jsonResponse({ status: "ok" }),
            );
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await import("../src/background.js");
    const tabUpdated =
      globalThis.chrome.tabs.onUpdated.addListener.mock.calls[0][0];
    const update = tabUpdated(
      31,
      { status: "complete" },
      { url: "https://media.example.test/video.mp4" },
    );

    await vi.waitFor(() => expect(acceptDownload).toBeTypeOf("function"));
    expect(globalThis.chrome.action.setIcon).toHaveBeenCalledWith({
      path: {
        16: "icons/icon-saving-16.png",
        48: "icons/icon-saving-48.png",
        128: "icons/icon-saving-128.png",
      },
      tabId: 31,
    });

    acceptDownload();
    await update;
    expect(globalThis.chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: {
        16: "icons/icon-saved-16.png",
        48: "icons/icon-saved-48.png",
        128: "icons/icon-saved-128.png",
      },
      tabId: 31,
    });
  });

  it("shows a failure icon when the downloader request throws", async () => {
    globalThis.chrome.storage = {
      local: {
        get: vi.fn(async () => ({
          activeTargetId: "home",
          targets: [
            {
              id: "home",
              name: "Home",
              metubeUrl: "https://downloads.example.test",
            },
          ],
        })),
        set: vi.fn(async () => {}),
      },
    };
    globalThis.chrome.cookies = { getAll: vi.fn(async () => []) };
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network unavailable");
    });
    await import("../src/background.js");
    const messageHandler =
      globalThis.chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const response = new Promise((resolve) => {
      messageHandler(
        {
          type: "submit-url",
          url: "https://media.example.test/video.mp4",
          tabId: 41,
        },
        {},
        resolve,
      );
    });

    await expect(response).resolves.toEqual({
      ok: false,
      error: "network unavailable",
    });
    expect(globalThis.chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: {
        16: "icons/icon-failed-16.png",
        48: "icons/icon-failed-48.png",
        128: "icons/icon-failed-128.png",
      },
      tabId: 41,
    });
  });

  it("restores the normal icon when a tab finishes navigating", async () => {
    globalThis.chrome.storage = {
      local: {
        get: vi.fn(async () => ({ targets: [], autoSaveEnabled: false })),
        set: vi.fn(async () => {}),
      },
    };
    await import("../src/background.js");
    const tabUpdated =
      globalThis.chrome.tabs.onUpdated.addListener.mock.calls[0][0];

    await tabUpdated(
      51,
      { status: "complete" },
      { url: "https://example.test/article" },
    );

    expect(globalThis.chrome.action.setIcon).toHaveBeenCalledWith({
      path: {
        16: "icons/icon-16.png",
        48: "icons/icon-48.png",
        128: "icons/icon-128.png",
      },
      tabId: 51,
    });
    expect(globalThis.chrome.action.setTitle).toHaveBeenCalledWith({
      title: "Hoarder",
      tabId: 51,
    });
  });

  it("shows toolbar status for keyboard shortcut submissions", async () => {
    globalThis.chrome.storage = {
      local: {
        get: vi.fn(async () => ({ targets: [] })),
        set: vi.fn(async () => {}),
      },
    };
    globalThis.chrome.tabs.query = vi.fn(async () => [
      { id: 61, url: "https://media.example.test/video.mp4" },
    ]);
    globalThis.chrome.notifications = { create: vi.fn() };
    await import("../src/background.js");
    const commandHandler =
      globalThis.chrome.commands.onCommand.addListener.mock.calls[0][0];

    await commandHandler("archive-page");

    expect(globalThis.chrome.action.setIcon).toHaveBeenNthCalledWith(1, {
      path: {
        16: "icons/icon-saving-16.png",
        48: "icons/icon-saving-48.png",
        128: "icons/icon-saving-128.png",
      },
      tabId: 61,
    });
    expect(globalThis.chrome.action.setIcon).toHaveBeenLastCalledWith({
      path: {
        16: "icons/icon-failed-16.png",
        48: "icons/icon-failed-48.png",
        128: "icons/icon-failed-128.png",
      },
      tabId: 61,
    });
  });
});
