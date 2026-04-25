#!/usr/bin/env node

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BRAND_ASSET_PATHS, type DesktopBuildIconAssets } from "./lib/brand-assets.ts";

type BuildPlatform = "mac" | "linux" | "win";
type BuildArch = "arm64" | "x64";

interface BuildOptions {
  readonly platform: BuildPlatform;
  readonly target: string;
  readonly arch: BuildArch;
  readonly version: string;
  readonly outputDir: string;
  readonly skipBuild: boolean;
  readonly signed: boolean;
  readonly verbose: boolean;
  readonly mockUpdates: boolean;
  readonly mockUpdateServerPort: number;
}

interface PackageJson {
  readonly version?: string;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const bundledDependencyFileExclusions = ["!node_modules/@lensflare/**"];

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function getFlagValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: readonly string[], name: string): boolean {
  return args.includes(name);
}

function detectPlatform(): BuildPlatform {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "linux") return "linux";
  if (process.platform === "win32") return "win";
  throw new Error(`Unsupported build host platform '${process.platform}'.`);
}

function defaultTarget(platform: BuildPlatform): string {
  if (platform === "mac") return "dmg";
  if (platform === "linux") return "AppImage";
  return "nsis";
}

function normalizePlatform(value: string | undefined): BuildPlatform {
  if (!value) return detectPlatform();
  if (value === "mac" || value === "linux" || value === "win") return value;
  throw new Error(`Invalid platform '${value}'. Expected mac, linux, or win.`);
}

function normalizeArch(value: string | undefined): BuildArch {
  const arch = value ?? (process.arch === "arm64" ? "arm64" : "x64");
  if (arch === "arm64" || arch === "x64") return arch;
  throw new Error(`Invalid arch '${arch}'. Expected arm64 or x64.`);
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Mock update server port must be a valid TCP port.");
  }
  return port;
}

export function resolveDesktopUpdateChannel(version: string): "latest" | "nightly" {
  return /-nightly\.\d{8}\.\d+$/.test(version) ? "nightly" : "latest";
}

export function resolveDesktopProductName(version: string): string {
  return resolveDesktopUpdateChannel(version) === "nightly" ? "Lensflare Nightly" : "Lensflare";
}

export function resolveDesktopBuildIconAssets(version: string): DesktopBuildIconAssets {
  if (resolveDesktopUpdateChannel(version) === "nightly") {
    return {
      macIconIcns: BRAND_ASSET_PATHS.nightlyMacIconIcns,
      linuxIconPng: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
      windowsIconIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
      webFaviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      webFavicon16Png: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
      webFavicon32Png: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
      webAppleTouchIconPng: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    };
  }

  return {
    macIconIcns: BRAND_ASSET_PATHS.productionMacIconIcns,
    linuxIconPng: BRAND_ASSET_PATHS.productionLinuxIconPng,
    windowsIconIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    webFaviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    webFavicon16Png: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    webFavicon32Png: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    webAppleTouchIconPng: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
  };
}

export function resolveMockUpdateServerUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function resolveGitHubPublishConfig(updateChannel: "latest" | "nightly"): {
  readonly provider: "github";
  readonly owner: string;
  readonly repo: string;
  readonly releaseType: "release" | "prerelease";
  readonly channel?: "nightly";
} | null {
  const rawRepository =
    process.env.LENSFLARE_DESKTOP_UPDATE_REPOSITORY?.trim() ||
    process.env.GITHUB_REPOSITORY?.trim() ||
    "";
  if (!rawRepository) return null;

  const [owner, repo, ...rest] = rawRepository.split("/");
  if (!owner || !repo || rest.length > 0) return null;

  return {
    provider: "github",
    owner,
    repo,
    releaseType: updateChannel === "nightly" ? "prerelease" : "release",
    ...(updateChannel === "nightly" ? { channel: "nightly" as const } : {}),
  };
}

function resolveBuildOptions(args: readonly string[]): BuildOptions {
  const desktopPackageJson = readJson<PackageJson>(join(repoRoot, "apps/desktop/package.json"));
  const platform = normalizePlatform(
    getFlagValue(args, "--platform") ?? process.env.LENSFLARE_DESKTOP_PLATFORM,
  );
  const arch = normalizeArch(getFlagValue(args, "--arch") ?? process.env.LENSFLARE_DESKTOP_ARCH);
  const version =
    getFlagValue(args, "--build-version") ??
    process.env.LENSFLARE_DESKTOP_VERSION ??
    desktopPackageJson.version ??
    "0.0.0";
  const mockUpdates =
    hasFlag(args, "--mock-updates") || process.env.LENSFLARE_DESKTOP_MOCK_UPDATES === "1";
  const outputDir = resolve(
    repoRoot,
    getFlagValue(args, "--output-dir") ??
      process.env.LENSFLARE_DESKTOP_OUTPUT_DIR ??
      (mockUpdates ? "release-mock" : "release"),
  );

  return {
    platform,
    arch,
    version,
    outputDir,
    target:
      getFlagValue(args, "--target") ??
      process.env.LENSFLARE_DESKTOP_TARGET ??
      defaultTarget(platform),
    skipBuild: hasFlag(args, "--skip-build") || process.env.LENSFLARE_DESKTOP_SKIP_BUILD === "1",
    signed: hasFlag(args, "--signed") || process.env.LENSFLARE_DESKTOP_SIGNED === "1",
    verbose: hasFlag(args, "--verbose") || process.env.LENSFLARE_DESKTOP_VERBOSE === "1",
    mockUpdates,
    mockUpdateServerPort: parsePort(
      getFlagValue(args, "--mock-update-server-port") ??
        process.env.LENSFLARE_DESKTOP_MOCK_UPDATE_SERVER_PORT,
    ),
  };
}

function run(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv; readonly verbose?: boolean },
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    shell: process.platform === "win32",
    stdio: options.verbose ? "inherit" : ["inherit", "ignore", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "null"}.`,
    );
  }
}

function createBuildConfig(options: BuildOptions): Record<string, unknown> {
  const updateChannel = resolveDesktopUpdateChannel(options.version);
  const iconAssets = resolveDesktopBuildIconAssets(options.version);
  const publishConfig = resolveGitHubPublishConfig(updateChannel);
  const publish = publishConfig
    ? [publishConfig]
    : options.mockUpdates
      ? [{ provider: "generic", url: resolveMockUpdateServerUrl(options.mockUpdateServerPort) }]
      : undefined;

  const config: Record<string, unknown> = {
    appId: "com.thespacecompany.lensflare",
    productName: resolveDesktopProductName(options.version),
    artifactName: "Lensflare-${version}-${arch}.${ext}",
    directories: {
      output: options.outputDir,
    },
    files: [
      "dist/**",
      "package.json",
      ...bundledDependencyFileExclusions,
      ...nativeDependencyFileExclusions(options.platform, options.arch),
    ],
    extraMetadata: {
      version: options.version,
    },
    extraResources: [
      {
        from: "../web/dist",
        to: "web",
      },
    ],
  };

  if (publish) {
    config.publish = publish;
  }

  if (options.platform === "mac") {
    config.mac = {
      target: options.target === "dmg" ? ["dmg", "zip"] : [options.target],
      icon: resolve(repoRoot, iconAssets.macIconIcns),
      category: "public.app-category.developer-tools",
      ...(options.signed ? {} : { identity: null }),
    };
  }

  if (options.platform === "linux") {
    config.linux = {
      target: [options.target],
      executableName: "lensflare",
      icon: resolve(repoRoot, iconAssets.linuxIconPng),
      category: "Development",
    };
  }

  if (options.platform === "win") {
    config.win = {
      target: [options.target],
      icon: resolve(repoRoot, iconAssets.windowsIconIco),
      ...(options.signed ? {} : { signAndEditExecutable: false }),
    };
  }

  return config;
}

function nativeDependencyFileExclusions(platform: BuildPlatform, arch: BuildArch): string[] {
  const duckDbPackages = [
    "node-bindings-darwin-arm64",
    "node-bindings-darwin-x64",
    "node-bindings-linux-arm64",
    "node-bindings-linux-x64",
    "node-bindings-win32-arm64",
    "node-bindings-win32-x64",
  ];
  const msgpackrExtractPackages = [
    "msgpackr-extract-darwin-arm64",
    "msgpackr-extract-darwin-x64",
    "msgpackr-extract-linux-arm",
    "msgpackr-extract-linux-arm64",
    "msgpackr-extract-linux-x64",
    "msgpackr-extract-win32-x64",
  ];

  const duckDbTarget =
    platform === "mac"
      ? `node-bindings-darwin-${arch}`
      : platform === "linux"
        ? `node-bindings-linux-${arch}`
        : `node-bindings-win32-${arch}`;
  const msgpackrExtractTarget =
    platform === "mac"
      ? `msgpackr-extract-darwin-${arch}`
      : platform === "linux"
        ? `msgpackr-extract-linux-${arch}`
        : `msgpackr-extract-win32-${arch}`;

  return [
    ...duckDbPackages
      .filter((packageName) => packageName !== duckDbTarget)
      .map((packageName) => `!node_modules/@duckdb/${packageName}/**`),
    ...msgpackrExtractPackages
      .filter((packageName) => packageName !== msgpackrExtractTarget)
      .map((packageName) => `!node_modules/@msgpackr-extract/${packageName}/**`),
  ];
}

function applyWebIconAssets(webDistDir: string, iconAssets: DesktopBuildIconAssets): void {
  mkdirSync(webDistDir, { recursive: true });
  copyFileSync(resolve(repoRoot, iconAssets.webFaviconIco), join(webDistDir, "favicon.ico"));
  copyFileSync(
    resolve(repoRoot, iconAssets.webFavicon16Png),
    join(webDistDir, "favicon-16x16.png"),
  );
  copyFileSync(
    resolve(repoRoot, iconAssets.webFavicon32Png),
    join(webDistDir, "favicon-32x32.png"),
  );
  copyFileSync(
    resolve(repoRoot, iconAssets.webAppleTouchIconPng),
    join(webDistDir, "apple-touch-icon.png"),
  );
}

export function buildDesktopArtifact(options: BuildOptions): void {
  const iconAssets = resolveDesktopBuildIconAssets(options.version);

  if (!options.skipBuild) {
    console.log("[desktop-artifact] Building web and desktop bundles...");
    run("pnpm", ["--dir", "apps/web", "run", "build"], { cwd: repoRoot, verbose: options.verbose });
    run("pnpm", ["--dir", "apps/desktop", "run", "build:bundle"], {
      cwd: repoRoot,
      verbose: options.verbose,
    });
  }
  applyWebIconAssets(join(repoRoot, "apps/web/dist"), iconAssets);

  const tempDir = mkdtempSync(join(tmpdir(), "lensflare-desktop-build-"));
  const configPath = join(tempDir, "electron-builder.json");
  const buildConfig = createBuildConfig(options);
  writeFileSync(configPath, `${JSON.stringify(buildConfig, null, 2)}\n`, "utf8");

  const buildEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(process.env.LENSFLARE_DESKTOP_UPDATE_GITHUB_TOKEN
      ? { GH_TOKEN: process.env.LENSFLARE_DESKTOP_UPDATE_GITHUB_TOKEN }
      : {}),
  };
  if (!options.signed) {
    buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    delete buildEnv.CSC_LINK;
    delete buildEnv.CSC_KEY_PASSWORD;
    delete buildEnv.APPLE_API_KEY;
    delete buildEnv.APPLE_API_KEY_ID;
    delete buildEnv.APPLE_API_ISSUER;
  }

  const platformFlag =
    options.platform === "mac" ? "--mac" : options.platform === "linux" ? "--linux" : "--win";
  console.log(
    `[desktop-artifact] Building ${options.platform}/${options.target} arch=${options.arch} version=${options.version}`,
  );
  try {
    run(
      "pnpm",
      [
        "exec",
        "electron-builder",
        "--config",
        configPath,
        platformFlag,
        `--${options.arch}`,
        "--publish",
        "never",
      ],
      {
        cwd: join(repoRoot, "apps/desktop"),
        env: buildEnv,
        verbose: true,
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    buildDesktopArtifact(resolveBuildOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
