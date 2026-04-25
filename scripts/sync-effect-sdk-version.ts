#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const workspacePath = join(repoRoot, "pnpm-workspace.yaml");

interface PackageJson {
  version?: string;
  peerDependencies?: Record<string, string>;
}

function readEffectCatalogVersion(): string {
  const workspaceSource = readFileSync(workspacePath, "utf8");
  const match = /^  effect:\s*([^\s#]+)\s*$/m.exec(workspaceSource);
  if (!match?.[1]) {
    throw new Error("Could not find catalog effect version in pnpm-workspace.yaml.");
  }

  return match[1];
}

function parseHotfix(argv: ReadonlyArray<string>): number | undefined {
  const hotfixIndex = argv.indexOf("--hotfix");
  const raw =
    hotfixIndex >= 0
      ? argv[hotfixIndex + 1]
      : (process.env.LENSFLARE_EFFECT_SDK_HOTFIX ?? "").trim();

  if (!raw) {
    return undefined;
  }

  const hotfix = Number.parseInt(raw, 10);
  if (!Number.isInteger(hotfix) || hotfix < 1) {
    throw new Error("Effect SDK hotfix must be a positive integer.");
  }

  return hotfix;
}

function resolveSdkVersion(effectVersion: string, hotfix: number | undefined): string {
  if (hotfix === undefined) {
    return effectVersion;
  }

  const prereleaseIndex = effectVersion.indexOf("-");
  if (prereleaseIndex >= 0) {
    return `${effectVersion}-lensflare.${hotfix}`;
  }

  const parts = effectVersion.split(".");
  if (parts.length !== 3) {
    throw new Error(`Cannot derive stable hotfix version from '${effectVersion}'.`);
  }

  const [major, minor, patchRaw] = parts;
  const patch = Number.parseInt(patchRaw ?? "", 10);
  if (!major || !minor || !Number.isInteger(patch)) {
    throw new Error(`Cannot derive stable hotfix version from '${effectVersion}'.`);
  }

  return `${major}.${minor}.${patch + hotfix}`;
}

function syncPackageVersion(options: { readonly rootDir?: string; readonly hotfix?: number }): {
  readonly version: string;
  readonly effectVersion: string;
  readonly changed: boolean;
} {
  const rootDir = resolve(options.rootDir ?? repoRoot);
  const resolvedWorkspacePath = join(rootDir, "pnpm-workspace.yaml");
  const resolvedPackagePath = join(rootDir, "packages/effect/package.json");
  const workspaceSource = readFileSync(resolvedWorkspacePath, "utf8");
  const match = /^  effect:\s*([^\s#]+)\s*$/m.exec(workspaceSource);
  if (!match?.[1]) {
    throw new Error("Could not find catalog effect version in pnpm-workspace.yaml.");
  }

  const effectVersion = match[1];
  const version = resolveSdkVersion(effectVersion, options.hotfix);
  const packageJson = JSON.parse(readFileSync(resolvedPackagePath, "utf8")) as PackageJson;
  const peerDependencies = {
    ...packageJson.peerDependencies,
    effect: effectVersion,
  };

  const nextPackageJson = {
    ...packageJson,
    version,
    peerDependencies,
  };
  const nextSource = `${JSON.stringify(nextPackageJson, null, 2)}\n`;
  const currentSource = readFileSync(resolvedPackagePath, "utf8");
  if (nextSource !== currentSource) {
    writeFileSync(resolvedPackagePath, nextSource, "utf8");
    return { version, effectVersion, changed: true };
  }

  return { version, effectVersion, changed: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const hotfix = parseHotfix(process.argv.slice(2));
    const effectVersion = readEffectCatalogVersion();
    const result = syncPackageVersion(hotfix === undefined ? {} : { hotfix });
    const hotfixLabel = hotfix === undefined ? "" : ` hotfix ${hotfix}`;
    const changedLabel = result.changed ? "updated" : "already up to date";
    console.log(
      `@lensflare/effect ${changedLabel}: ${result.version} targets effect ${effectVersion}${hotfixLabel}.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export { resolveSdkVersion, syncPackageVersion };
