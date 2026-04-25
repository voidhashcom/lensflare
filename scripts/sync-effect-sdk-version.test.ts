import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveSdkVersion, syncPackageVersion } from "./sync-effect-sdk-version.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(effectVersion: string): string {
  const rootDir = join(tmpdir(), `lensflare-effect-sdk-version-${randomUUID()}`);
  tempDirs.push(rootDir);
  mkdirSync(join(rootDir, "packages/effect"), { recursive: true });
  writeFileSync(
    join(rootDir, "pnpm-workspace.yaml"),
    `packages:
  - packages/*
catalog:
  effect: ${effectVersion}
`,
  );
  writeFileSync(
    join(rootDir, "packages/effect/package.json"),
    `${JSON.stringify(
      {
        name: "@lensflare/effect",
        version: "0.0.0",
        peerDependencies: {
          effect: "0.0.0",
        },
      },
      null,
      2,
    )}\n`,
  );
  return rootDir;
}

describe("sync-effect-sdk-version", () => {
  it("uses the Effect catalog version as the SDK version by default", () => {
    expect(resolveSdkVersion("4.0.0-beta.55", undefined)).toBe("4.0.0-beta.55");
    expect(resolveSdkVersion("4.0.0", undefined)).toBe("4.0.0");
  });

  it("uses a Lensflare prerelease suffix for beta hotfixes", () => {
    expect(resolveSdkVersion("4.0.0-beta.55", 1)).toBe("4.0.0-beta.55-lensflare.1");
  });

  it("uses the next patch versions for stable hotfixes", () => {
    expect(resolveSdkVersion("4.0.0", 1)).toBe("4.0.1");
    expect(resolveSdkVersion("4.0.0", 2)).toBe("4.0.2");
  });

  it("syncs package version and peer dependency from the workspace catalog", () => {
    const rootDir = makeWorkspace("4.0.0-beta.55");

    const result = syncPackageVersion({ rootDir });
    const packageJson = JSON.parse(
      readFileSync(join(rootDir, "packages/effect/package.json"), "utf8"),
    ) as {
      readonly version: string;
      readonly peerDependencies: { readonly effect: string };
    };

    expect(result).toEqual({
      version: "4.0.0-beta.55",
      effectVersion: "4.0.0-beta.55",
      changed: true,
    });
    expect(packageJson.version).toBe("4.0.0-beta.55");
    expect(packageJson.peerDependencies.effect).toBe("4.0.0-beta.55");
  });
});
