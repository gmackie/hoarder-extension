import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const popupPath = new URL("../src/popup/popup.html", import.meta.url);
const popupCssPath = new URL("../src/popup/popup.css", import.meta.url);
const popupScriptPath = new URL("../src/popup/popup.js", import.meta.url);

describe("portable target editor", () => {
  it("provides an accessible document language and title", async () => {
    const html = await readFile(popupPath, "utf8");

    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<title>Hoarder</title>");
  });

  it("gives the manual URL field an accessible name", async () => {
    const html = await readFile(popupPath, "utf8");

    expect(html).toContain(
      'type="url" id="manual-url" aria-label="URL to archive"',
    );
  });

  it("announces asynchronous status changes", async () => {
    const html = await readFile(popupPath, "utf8");

    expect(html).toContain(
      'id="page-status" role="status" aria-live="polite"',
    );
    expect(html).toContain(
      'id="settings-status" role="status" aria-live="polite"',
    );
  });

  it("keeps keyboard focus visible on interactive controls", async () => {
    const css = await readFile(popupCssPath, "utf8");

    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline:");
  });

  it("reports manual submissions without replacing the entered URL", async () => {
    const [html, script] = await Promise.all([
      readFile(popupPath, "utf8"),
      readFile(popupScriptPath, "utf8"),
    ]);

    expect(html).toContain(
      'id="manual-status" role="status" aria-live="polite"',
    );
    expect(script).toContain('const manualStatus = document.getElementById("manual-status")');
    expect(script).not.toContain('input.value = result.ok ? "Submitted!"');
  });

  it("requires confirmation before removing a configured target", async () => {
    const script = await readFile(popupScriptPath, "utf8");

    expect(script).toContain("window.confirm(");
    expect(script).toContain("This cannot be undone.");
  });

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
