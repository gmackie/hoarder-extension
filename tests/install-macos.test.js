import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hoarder-install-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runInstaller(...arguments_) {
  return execFileSync("sh", ["scripts/install-macos.sh", ...arguments_], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });
}

describe("macOS installer", () => {
  test("stages an unpacked extension from a local build directory", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source");
    const destination = path.join(root, "Hoarder Extension", "current");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      path.join(source, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "9.8.7" }),
    );
    fs.mkdirSync(path.join(source, "src"));
    fs.writeFileSync(path.join(source, "src", "background.js"), "// extension");

    const output = runInstaller(
      "--source-dir",
      source,
      "--install-dir",
      destination,
    );

    expect(JSON.parse(fs.readFileSync(path.join(destination, "manifest.json"))))
      .toMatchObject({ name: "Hoarder", version: "9.8.7" });
    expect(fs.readFileSync(path.join(destination, "src", "background.js"), "utf8"))
      .toBe("// extension");
    expect(output).toContain(destination);
  });

  test("preserves the installed private configuration during an update", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source");
    const destination = path.join(root, "current");
    fs.mkdirSync(path.join(source, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "2.0.0" }),
    );
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(
      path.join(destination, "local-config.json"),
      JSON.stringify({ targets: [{ name: "Private target" }] }),
    );

    runInstaller("--source-dir", source, "--install-dir", destination);

    expect(JSON.parse(fs.readFileSync(path.join(destination, "local-config.json"))))
      .toEqual({ targets: [{ name: "Private target" }] });
  });

  test("installs an explicitly supplied target configuration", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source");
    const destination = path.join(root, "current");
    const configuration = path.join(root, "targets.json");
    fs.mkdirSync(path.join(source, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "1.0.0" }),
    );
    fs.writeFileSync(
      configuration,
      JSON.stringify({ targets: [{ name: "My NAS" }], autoSaveVideos: true }),
    );

    runInstaller(
      "--source-dir",
      source,
      "--install-dir",
      destination,
      "--config",
      configuration,
    );

    expect(JSON.parse(fs.readFileSync(path.join(destination, "local-config.json"))))
      .toEqual({ targets: [{ name: "My NAS" }], autoSaveVideos: true });
  });

  test("verifies and stages a release archive", () => {
    const root = temporaryDirectory();
    const bundle = path.join(root, "bundle");
    const source = path.join(bundle, "brave");
    const archive = path.join(root, "hoarder.zip");
    const destination = path.join(root, "current");
    fs.mkdirSync(path.join(source, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(source, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "3.2.1" }),
    );
    fs.writeFileSync(path.join(source, "src", "background.js"), "// release");
    execFileSync("zip", ["-qr", archive, "brave"], { cwd: bundle });
    const checksum = crypto.createHash("sha256")
      .update(fs.readFileSync(archive))
      .digest("hex");

    runInstaller(
      "--archive",
      archive,
      "--sha256",
      checksum,
      "--install-dir",
      destination,
    );

    expect(JSON.parse(fs.readFileSync(path.join(destination, "manifest.json"))))
      .toMatchObject({ version: "3.2.1" });
  });

  test("rejects a release archive with the wrong checksum", () => {
    const root = temporaryDirectory();
    const archive = path.join(root, "hoarder.zip");
    const destination = path.join(root, "current");
    fs.writeFileSync(archive, "not the expected release");

    const result = spawnSync(
      "sh",
      [
        "scripts/install-macos.sh",
        "--archive",
        archive,
        "--sha256",
        "0".repeat(64),
        "--install-dir",
        destination,
      ],
      { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SHA-256 mismatch");
    expect(fs.existsSync(destination)).toBe(false);
  });

  test("downloads a named release from an overridable release location", () => {
    const root = temporaryDirectory();
    const releaseRoot = path.join(root, "releases", "download");
    const bundle = path.join(root, "bundle");
    const source = path.join(bundle, "brave");
    const version = "4.5.6";
    const versionDirectory = path.join(releaseRoot, `v${version}`);
    const archive = path.join(versionDirectory, `hoarder-extension-v${version}.zip`);
    const destination = path.join(root, "current");
    fs.mkdirSync(path.join(source, "src"), { recursive: true });
    fs.mkdirSync(versionDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(source, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version }),
    );
    execFileSync("zip", ["-qr", archive, "brave"], { cwd: bundle });
    const checksum = crypto.createHash("sha256")
      .update(fs.readFileSync(archive))
      .digest("hex");

    runInstaller(
      "--version",
      version,
      "--sha256",
      checksum,
      "--release-base-url",
      `file://${releaseRoot}`,
      "--install-dir",
      destination,
    );

    expect(JSON.parse(fs.readFileSync(path.join(destination, "manifest.json"))))
      .toMatchObject({ version });
  });
});
