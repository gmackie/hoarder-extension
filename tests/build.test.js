import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

let outputDir;

afterEach(async () => {
  if (outputDir) await rm(outputDir, { recursive: true, force: true });
});

describe("Brave build", () => {
  it("creates a loadable unpacked extension", async () => {
    outputDir = await mkdtemp(join(tmpdir(), "hoarder-build-"));
    const result = spawnSync(
      process.execPath,
      ["build.js", "--output", outputDir],
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(
      await readFile(join(outputDir, "manifest.json"), "utf8"),
    );
    expect(manifest.background.service_worker).toBe("src/background.js");
    expect(await readFile(join(outputDir, "src/background.js"), "utf8"))
      .toContain("chrome.runtime.onInstalled");
  });
});
