import { beforeEach, describe, expect, it, vi } from "vitest";

describe("extension installation", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.chrome = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() },
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
});
