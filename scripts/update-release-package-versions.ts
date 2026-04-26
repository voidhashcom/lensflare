#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const appReleasePackageFiles = [
  "apps/desktop/package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "internal/contracts/package.json",
  "internal/local-server/package.json",
  "internal/shared/package.json",
] as const;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export function updateReleasePackageVersions(
  version: string,
  options: { readonly rootDir?: string } = {},
): { readonly changed: boolean } {
  const rootDir = resolve(options.rootDir ?? repoRoot);
  let changed = false;

  for (const relativePath of appReleasePackageFiles) {
    const filePath = join(rootDir, relativePath);
    const packageJson = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (packageJson.version !== version) {
      packageJson.version = version;
      writeFileSync(filePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
      changed = true;
    }
  }

  const browserPath = join(rootDir, "internal/shared/src/browser.ts");
  const browserSource = readFileSync(browserPath, "utf8");
  const nextBrowserSource = browserSource.replace(
    /export const APP_VERSION = "([^"]+)";/,
    `export const APP_VERSION = "${version}";`,
  );
  if (nextBrowserSource !== browserSource) {
    writeFileSync(browserPath, nextBrowserSource, "utf8");
    changed = true;
  }

  return { changed };
}

function parseArgs(argv: readonly string[]): {
  readonly version: string;
  readonly rootDir?: string;
  readonly githubOutput: boolean;
} {
  const [version] = argv.filter((arg) => !arg.startsWith("--"));
  if (!version) {
    throw new Error(
      "Usage: update-release-package-versions <version> [--root <path>] [--github-output]",
    );
  }

  const rootIndex = argv.indexOf("--root");
  return {
    version,
    ...(rootIndex >= 0 && argv[rootIndex + 1] ? { rootDir: argv[rootIndex + 1] } : {}),
    githubOutput: argv.includes("--github-output"),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = updateReleasePackageVersions(
      args.version,
      args.rootDir ? { rootDir: args.rootDir } : {},
    );
    if (args.githubOutput && process.env.GITHUB_OUTPUT) {
      writeFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\n`, { flag: "a" });
    }
    if (!result.changed) {
      console.log("All release package versions already match.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
