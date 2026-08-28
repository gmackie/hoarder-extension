import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";


describe("library image-ingest deployment", () => {
  it("proxies the extension contract through the public library origin", async () => {
    const nginx = await readFile(
      new URL("../library/apps/web/nginx.conf", import.meta.url),
      "utf8",
    );

    expect(nginx).toMatch(/location = \/upload\s*\{[^}]*proxy_pass http:\/\/api:8000/m);
    expect(nginx).toMatch(/location = \/destinations\s*\{[^}]*proxy_pass http:\/\/api:8000/m);
  });

  it("keeps archive mounts read-only and gives managed images their own writable mount", async () => {
    const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");

    expect(compose).toContain(":/media/primary:ro");
    expect(compose).toContain(":/media/secondary:ro");
    expect(compose).toContain(":/media/saved-images");
    expect(compose).not.toContain(":/media/saved-images:ro");
    expect(compose).toContain('"accepts_images":true');
  });
});
