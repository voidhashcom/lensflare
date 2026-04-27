import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  mergePlatformUpdateManifests,
  mergeUpdateManifestFiles,
  parseArgs,
  parsePlatformUpdateManifest,
  serializePlatformUpdateManifest,
} from "./merge-update-manifests.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lensflare-merge-update-manifests-"));
  tempDirs.push(dir);
  return dir;
}

describe("merge-update-manifests", () => {
  it("accepts a package-manager argument separator before CLI options", () => {
    expect(
      parseArgs([
        "--",
        "--platform",
        "mac",
        "downloaded-artifacts/desktop-mac-arm64/latest-mac.yml",
        "downloaded-artifacts/desktop-mac-x64/latest-mac.yml",
        "release-upload/latest-mac.yml",
      ]),
    ).toEqual({
      platform: "mac",
      primaryPath: "downloaded-artifacts/desktop-mac-arm64/latest-mac.yml",
      secondaryPath: "downloaded-artifacts/desktop-mac-x64/latest-mac.yml",
      outputPath: "release-upload/latest-mac.yml",
    });
  });

  it("merges arm64 and x64 macOS update manifests into one multi-arch manifest", () => {
    const arm64 = parsePlatformUpdateManifest(
      "mac",
      `version: 0.1.0
files:
  - url: Lensflare-0.1.0-arm64.zip
    sha512: arm64zip
    size: 125621344
  - url: Lensflare-0.1.0-arm64.dmg
    sha512: arm64dmg
    size: 131754935
path: Lensflare-0.1.0-arm64.zip
sha512: arm64zip
releaseDate: '2026-03-07T10:32:14.587Z'
`,
      "latest-mac.yml",
    );

    const x64 = parsePlatformUpdateManifest(
      "mac",
      `version: 0.1.0
files:
  - url: Lensflare-0.1.0-x64.zip
    sha512: x64zip
    size: 132000112
  - url: Lensflare-0.1.0-x64.dmg
    sha512: x64dmg
    size: 138148807
path: Lensflare-0.1.0-x64.zip
sha512: x64zip
releaseDate: '2026-03-07T10:36:07.540Z'
`,
      "latest-mac-x64.yml",
    );

    const merged = mergePlatformUpdateManifests("mac", arm64, x64);

    expect(merged.version).toBe("0.1.0");
    expect(merged.releaseDate).toBe("2026-03-07T10:36:07.540Z");
    expect(merged.files.map((file) => file.url)).toEqual([
      "Lensflare-0.1.0-arm64.zip",
      "Lensflare-0.1.0-arm64.dmg",
      "Lensflare-0.1.0-x64.zip",
      "Lensflare-0.1.0-x64.dmg",
    ]);

    const serialized = serializePlatformUpdateManifest("mac", merged);
    expect(serialized).not.toContain("path:");
    expect(serialized.match(/- url:/g)).toHaveLength(4);
  });

  it("rejects mismatched manifest versions", () => {
    const primary = parsePlatformUpdateManifest(
      "win",
      `version: 0.1.0
files:
  - url: Lensflare-0.1.0-x64.exe
    sha512: x64exe
    size: 1
releaseDate: '2026-03-07T10:32:14.587Z'
`,
      "latest.yml",
    );
    const secondary = parsePlatformUpdateManifest(
      "win",
      `version: 0.1.1
files:
  - url: Lensflare-0.1.1-arm64.exe
    sha512: arm64exe
    size: 1
releaseDate: '2026-03-07T10:32:14.587Z'
`,
      "latest-arm64.yml",
    );

    expect(() => mergePlatformUpdateManifests("win", primary, secondary)).toThrow(
      /different versions/,
    );
  });

  it("writes the merged manifest to an explicit output path", () => {
    const dir = makeTempDir();
    const primaryPath = join(dir, "latest-mac-arm64.yml");
    const secondaryPath = join(dir, "latest-mac-x64.yml");
    const outputPath = join(dir, "latest-mac.yml");

    writeFileSync(
      primaryPath,
      `version: 0.1.0
files:
  - url: Lensflare-0.1.0-arm64.zip
    sha512: arm64zip
    size: 1
releaseDate: '2026-03-07T10:32:14.587Z'
`,
      "utf8",
    );
    writeFileSync(
      secondaryPath,
      `version: 0.1.0
files:
  - url: Lensflare-0.1.0-x64.zip
    sha512: x64zip
    size: 1
releaseDate: '2026-03-07T10:36:07.540Z'
`,
      "utf8",
    );

    mergeUpdateManifestFiles("mac", primaryPath, secondaryPath, outputPath);

    const merged = readFileSync(outputPath, "utf8");
    expect(merged).toContain("Lensflare-0.1.0-arm64.zip");
    expect(merged).toContain("Lensflare-0.1.0-x64.zip");
  });
});
