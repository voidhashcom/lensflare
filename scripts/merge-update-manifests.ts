#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  mergeUpdateManifests,
  parseUpdateManifest,
  serializeUpdateManifest,
  type UpdateManifest,
} from "./lib/update-manifest.ts";

export type UpdateManifestPlatform = "mac" | "win";

function getPlatformLabel(platform: UpdateManifestPlatform): string {
  return platform === "mac" ? "macOS" : "Windows";
}

export function parsePlatformUpdateManifest(
  platform: UpdateManifestPlatform,
  raw: string,
  sourcePath: string,
): UpdateManifest {
  return parseUpdateManifest(raw, sourcePath, getPlatformLabel(platform));
}

export function mergePlatformUpdateManifests(
  platform: UpdateManifestPlatform,
  primary: UpdateManifest,
  secondary: UpdateManifest,
): UpdateManifest {
  return mergeUpdateManifests(primary, secondary, getPlatformLabel(platform));
}

export function serializePlatformUpdateManifest(
  platform: UpdateManifestPlatform,
  manifest: UpdateManifest,
): string {
  return serializeUpdateManifest(manifest, {
    platformLabel: getPlatformLabel(platform),
  });
}

export function mergeUpdateManifestFiles(
  platform: UpdateManifestPlatform,
  primaryPathArg: string,
  secondaryPathArg: string,
  outputPathArg?: string,
): void {
  const primaryPath = resolve(primaryPathArg);
  const secondaryPath = resolve(secondaryPathArg);
  const outputPath = resolve(outputPathArg ?? primaryPathArg);

  const primaryManifest = parsePlatformUpdateManifest(
    platform,
    readFileSync(primaryPath, "utf8"),
    primaryPath,
  );
  const secondaryManifest = parsePlatformUpdateManifest(
    platform,
    readFileSync(secondaryPath, "utf8"),
    secondaryPath,
  );
  const merged = mergePlatformUpdateManifests(platform, primaryManifest, secondaryManifest);

  writeFileSync(outputPath, serializePlatformUpdateManifest(platform, merged), "utf8");
}

export function parseArgs(argv: readonly string[]): {
  readonly platform: UpdateManifestPlatform;
  readonly primaryPath: string;
  readonly secondaryPath: string;
  readonly outputPath?: string;
} {
  const args = argv.filter((arg) => arg !== "--");
  const platformFlagIndex = args.indexOf("--platform");
  if (platformFlagIndex < 0) {
    throw new Error("Missing required --platform mac|win option.");
  }
  const platform = args[platformFlagIndex + 1];
  args.splice(platformFlagIndex, 2);
  if (platform !== "mac" && platform !== "win") {
    throw new Error(`Invalid --platform value '${platform ?? ""}'. Expected mac or win.`);
  }
  const [primaryPath, secondaryPath, outputPath, ...rest] = args;
  if (!primaryPath || !secondaryPath || rest.length > 0) {
    throw new Error(
      "Usage: merge-update-manifests --platform mac|win <primary-path> <secondary-path> [output-path]",
    );
  }
  return {
    platform,
    primaryPath,
    secondaryPath,
    ...(outputPath ? { outputPath } : {}),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs(process.argv.slice(2));
    mergeUpdateManifestFiles(args.platform, args.primaryPath, args.secondaryPath, args.outputPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
