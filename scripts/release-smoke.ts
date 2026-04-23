#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const releaseDir = resolve(process.env.LENSFLARE_DESKTOP_OUTPUT_DIR ?? "release");

function hasMatchingFile(pattern: RegExp): boolean {
  if (!existsSync(releaseDir)) {
    return false;
  }
  return readdirSync(releaseDir).some((entry) => pattern.test(entry));
}

const requiredArtifacts: ReadonlyArray<[string, RegExp]> = [
  ["macOS updater manifest", /^(latest|nightly)-mac\.yml$/],
  ["Windows updater manifest", /^(latest|nightly)\.yml$/],
  ["Linux AppImage", /\.AppImage$/],
  ["blockmap", /\.blockmap$/],
];

let failed = false;
for (const [label, pattern] of requiredArtifacts) {
  if (!hasMatchingFile(pattern)) {
    console.error(`Missing ${label} in ${releaseDir}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Release smoke check passed for ${releaseDir}`);
