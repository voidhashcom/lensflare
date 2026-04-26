import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appReleasePackageFiles,
  updateReleasePackageVersions,
} from "./update-release-package-versions.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writePackage(rootDir: string, relativePath: string, version: string): void {
  const filePath = join(rootDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${JSON.stringify(
      {
        name: relativePath,
        version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function makeWorkspace(): string {
  const rootDir = join(tmpdir(), `lensflare-release-package-versions-${randomUUID()}`);
  tempDirs.push(rootDir);

  for (const relativePath of appReleasePackageFiles) {
    writePackage(rootDir, relativePath, "0.1.0");
  }

  writePackage(rootDir, "packages/effect/package.json", "4.0.0-beta.55");
  const browserPath = join(rootDir, "internal/shared/src/browser.ts");
  mkdirSync(dirname(browserPath), { recursive: true });
  writeFileSync(browserPath, 'export const APP_VERSION = "0.1.0";\n', "utf8");

  return rootDir;
}

describe("update-release-package-versions", () => {
  it("updates app release packages and APP_VERSION without changing the Effect SDK version", () => {
    const rootDir = makeWorkspace();

    const result = updateReleasePackageVersions("0.0.1-alpha.1", { rootDir });

    expect(result.changed).toBe(true);
    for (const relativePath of appReleasePackageFiles) {
      const packageJson = JSON.parse(readFileSync(join(rootDir, relativePath), "utf8")) as {
        readonly version: string;
      };
      expect(packageJson.version).toBe("0.0.1-alpha.1");
    }

    const effectPackageJson = JSON.parse(
      readFileSync(join(rootDir, "packages/effect/package.json"), "utf8"),
    ) as {
      readonly version: string;
    };
    expect(effectPackageJson.version).toBe("4.0.0-beta.55");
    expect(readFileSync(join(rootDir, "internal/shared/src/browser.ts"), "utf8")).toContain(
      'APP_VERSION = "0.0.1-alpha.1"',
    );
  });
});
