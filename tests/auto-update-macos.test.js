import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "hoarder-update-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function prepareRelease(root, version) {
  const releaseRoot = path.join(root, "releases", "download");
  const versionDirectory = path.join(releaseRoot, `v${version}`);
  const bundle = path.join(root, "bundle");
  const source = path.join(bundle, "brave");
  const archiveName = `hoarder-extension-v${version}.zip`;
  const archive = path.join(versionDirectory, archiveName);
  fs.mkdirSync(path.join(source, "src"), { recursive: true });
  fs.mkdirSync(versionDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(source, "manifest.json"),
    JSON.stringify({ name: "Hoarder", version }),
  );
  fs.writeFileSync(path.join(source, "src", "background.js"), "// updated");
  execFileSync("zip", ["-qr", archive, "brave"], { cwd: bundle });
  fs.writeFileSync(`${archive}.sha256`, `${sha256(archive)}  ${archiveName}\n`);

  const installer = path.join(versionDirectory, "install-hoarder.sh");
  fs.copyFileSync(
    path.resolve(import.meta.dirname, "../scripts/install-macos.sh"),
    installer,
  );
  fs.writeFileSync(
    `${installer}.sha256`,
    `${sha256(installer)}  install-hoarder.sh\n`,
  );
  return pathToFileURL(releaseRoot).href;
}

function runUpdater(...arguments_) {
  return spawnSync("sh", ["scripts/auto-update-macos.sh", ...arguments_], {
    cwd: path.resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });
}

describe("macOS automatic updater", () => {
  test("checks the Brave-picker-visible Applications directory by default", () => {
    const root = temporaryDirectory();
    const installDirectory = path.join(
      root,
      "Applications",
      "Hoarder Extension",
      "current",
    );
    fs.mkdirSync(installDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(installDirectory, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "1.0.7" }),
    );

    const result = spawnSync(
      "sh",
      ["scripts/auto-update-macos.sh", "--latest-version", "1.0.7"],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, HOME: root },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Hoarder 1.0.7 is current");
  });

  test("installs a newer checksummed release and preserves configuration", () => {
    const root = temporaryDirectory();
    const installDirectory = path.join(root, "current");
    const releaseBaseUrl = prepareRelease(root, "1.0.7");
    fs.mkdirSync(installDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(installDirectory, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "1.0.6" }),
    );
    fs.writeFileSync(
      path.join(installDirectory, "local-config.json"),
      JSON.stringify({ targets: [{ name: "Private target" }] }),
    );

    const result = runUpdater(
      "--latest-version",
      "1.0.7",
      "--release-base-url",
      releaseBaseUrl,
      "--install-dir",
      installDirectory,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(installDirectory, "manifest.json"))))
      .toMatchObject({ version: "1.0.7" });
    expect(JSON.parse(fs.readFileSync(path.join(installDirectory, "local-config.json"))))
      .toEqual({ targets: [{ name: "Private target" }] });
    expect(result.stdout).toContain("Updated Hoarder from 1.0.6 to 1.0.7");
  });

  test("does not download or downgrade when the installed version is current", () => {
    const root = temporaryDirectory();
    const installDirectory = path.join(root, "current");
    fs.mkdirSync(installDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(installDirectory, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "1.0.7" }),
    );

    const result = runUpdater(
      "--latest-version",
      "1.0.6",
      "--release-base-url",
      "file:///does-not-exist",
      "--install-dir",
      installDirectory,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Hoarder 1.0.7 is current");
  });

  test("recovers a stale update lock after an interrupted check", () => {
    const root = temporaryDirectory();
    const installDirectory = path.join(root, "current");
    const temporaryRoot = path.join(root, "tmp");
    const staleLock = path.join(temporaryRoot, "hoarder-auto-update.lock");
    fs.mkdirSync(installDirectory, { recursive: true });
    fs.mkdirSync(staleLock, { recursive: true });
    fs.writeFileSync(path.join(staleLock, "pid"), "999999999\n");
    fs.writeFileSync(
      path.join(installDirectory, "manifest.json"),
      JSON.stringify({ name: "Hoarder", version: "1.0.7" }),
    );

    const result = spawnSync(
      "sh",
      [
        "scripts/auto-update-macos.sh",
        "--latest-version",
        "1.0.7",
        "--install-dir",
        installDirectory,
      ],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: { ...process.env, TMPDIR: temporaryRoot },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Hoarder 1.0.7 is current");
    expect(fs.existsSync(staleLock)).toBe(false);
  });
});
