const fs = require("node:fs");
const path = require("node:path");

const outputFlag = process.argv.indexOf("--output");
const outputDir = path.resolve(
  outputFlag >= 0 ? process.argv[outputFlag + 1] : "dist/brave",
);

if (outputFlag >= 0 && !process.argv[outputFlag + 1]) {
  throw new Error("--output requires a directory");
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

for (const entry of ["manifest.json", "src", "icons"]) {
  fs.cpSync(path.resolve(entry), path.join(outputDir, entry), {
    recursive: true,
  });
}

console.log(`Built unpacked Brave extension at ${outputDir}`);
