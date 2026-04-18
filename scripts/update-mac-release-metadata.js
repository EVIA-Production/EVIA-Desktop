#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const latestMacPath = path.join(distDir, "latest-mac.yml");
const dmgPath = path.join(distDir, "taylos.dmg");

if (!fs.existsSync(dmgPath)) {
  throw new Error(`Missing DMG artifact: ${dmgPath}`);
}

if (!fs.existsSync(latestMacPath)) {
  throw new Error(`Missing latest-mac.yml: ${latestMacPath}`);
}

const appBuilderBinary = path.join(
  rootDir,
  "node_modules",
  "app-builder-bin",
  "mac",
  process.arch === "arm64" ? "app-builder_arm64" : "app-builder_amd64"
);

const lowercaseBlockmaps = [
  ["Taylos.zip.blockmap", "taylos.zip.blockmap"],
  ["Taylos.dmg.blockmap", "taylos.dmg.blockmap"],
];

for (const [legacyName, lowerName] of lowercaseBlockmaps) {
  const legacyPath = path.join(distDir, legacyName);
  const lowerPath = path.join(distDir, lowerName);
  if (fs.existsSync(lowerPath)) {
    fs.rmSync(lowerPath, { force: true });
  }
  if (fs.existsSync(legacyPath)) {
    fs.renameSync(legacyPath, lowerPath);
  }
}

const dmgBlockmapPath = path.join(distDir, "taylos.dmg.blockmap");
if (fs.existsSync(dmgBlockmapPath)) {
  fs.rmSync(dmgBlockmapPath, { force: true });
}

execFileSync(
  appBuilderBinary,
  ["blockmap", "--input", dmgPath, "--output", dmgBlockmapPath],
  { stdio: "inherit" }
);

const dmgBuffer = fs.readFileSync(dmgPath);
const dmgSha512 = crypto.createHash("sha512").update(dmgBuffer).digest("base64");
const dmgSize = fs.statSync(dmgPath).size;

let latestMac = fs.readFileSync(latestMacPath, "utf8");
latestMac = latestMac.replace(
  /(- url: taylos\.dmg\n\s+sha512: ).*\n(\s+size: ).*/m,
  `$1${dmgSha512}\n$2${dmgSize}`
);
latestMac = latestMac.replace(
  /releaseDate: '.*'/,
  `releaseDate: '${new Date().toISOString()}'`
);
fs.writeFileSync(latestMacPath, latestMac);

console.log("Updated macOS release metadata:");
console.log(`  ${latestMacPath}`);
console.log(`  ${dmgBlockmapPath}`);
