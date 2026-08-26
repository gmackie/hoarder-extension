import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const manifestPath = new URL("../manifest.json", import.meta.url);

describe("Brave manifest", () => {
  it("registers the background module as a Manifest V3 service worker", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background).toEqual({
      service_worker: "src/background.js",
      type: "module",
    });
  });

  it("uses portable host permissions without setup-specific names", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(manifest.content_scripts[0].matches).toEqual([
      "http://*/*",
      "https://*/*",
    ]);
  });
});
