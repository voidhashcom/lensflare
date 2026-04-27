import { afterEach, describe, expect, it, vi } from "vitest";

import { getLatestReleaseDownloads } from "./releases";

const createRelease = (tagName: string, assetName = "Lensflare-arm64.dmg") => ({
  tag_name: tagName,
  html_url: `https://github.com/voidhashcom/lensflare/releases/tag/${tagName}`,
  assets: [
    {
      name: assetName,
      browser_download_url: `https://example.com/${assetName}`,
    },
  ],
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getLatestReleaseDownloads", () => {
  it("uses the newest semver release instead of a nightly release", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return Response.json([createRelease("nightly-20260427.1"), createRelease("0.1.0")]);
      }),
    );

    const release = await getLatestReleaseDownloads();

    expect(release.versionLabel).toBe("0.1.0");
    expect(release.releaseUrl).toBe("https://github.com/voidhashcom/lensflare/releases/tag/0.1.0");
  });

  it("allows semver prereleases such as alpha releases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return Response.json([
          createRelease("0.0.1-alpha.1"),
          createRelease("0.0.1-nightly.20260427.1"),
          createRelease("0.0.1"),
        ]);
      }),
    );

    const release = await getLatestReleaseDownloads();

    expect(release.versionLabel).toBe("0.0.1-alpha.1");
  });
});
