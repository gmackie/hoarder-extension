import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const popupPath = new URL("../src/popup/popup.html", import.meta.url);

describe("portable target editor", () => {
  it("renders a dynamic destination selector and target settings", async () => {
    const html = await readFile(popupPath, "utf8");

    expect(html).toContain('id="destination"');
    expect(html).toContain('<select id="destination"></select>');
    expect(html).toContain('id="target-name"');
    expect(html).toContain('id="metube-url"');
    expect(html).toContain('id="metube-folder"');
    expect(html).toContain('id="image-api-url"');
    expect(html).toContain('id="image-destination"');
    expect(html).toContain('id="add-target"');
    expect(html).toContain('id="remove-target"');
  });

  it("offers opt-in automatic video saving controls", async () => {
    const html = await readFile(popupPath, "utf8");

    expect(html).toContain('id="auto-save"');
    expect(html).toContain('id="auto-save-delay"');
    expect(html).toContain("Automatically save detected videos");
  });
});
