import { afterEach, describe, expect, it } from "vitest";

import {
  resolveDesktopUpdateChannel,
  resolveGitHubPublishConfig,
} from "./build-desktop-artifact.ts";

const originalRepository = process.env.LENSFLARE_DESKTOP_UPDATE_REPOSITORY;
const originalGitHubRepository = process.env.GITHUB_REPOSITORY;

afterEach(() => {
  if (originalRepository === undefined) {
    delete process.env.LENSFLARE_DESKTOP_UPDATE_REPOSITORY;
  } else {
    process.env.LENSFLARE_DESKTOP_UPDATE_REPOSITORY = originalRepository;
  }

  if (originalGitHubRepository === undefined) {
    delete process.env.GITHUB_REPOSITORY;
  } else {
    process.env.GITHUB_REPOSITORY = originalGitHubRepository;
  }
});

describe("build-desktop-artifact release metadata", () => {
  it("keeps semver prereleases on the latest update channel", () => {
    expect(resolveDesktopUpdateChannel("0.0.1-alpha.1")).toBe("latest");
  });

  it("marks semver prereleases as GitHub prereleases", () => {
    process.env.LENSFLARE_DESKTOP_UPDATE_REPOSITORY = "voidhashcom/lensflare";
    delete process.env.GITHUB_REPOSITORY;

    expect(resolveGitHubPublishConfig("0.0.1-alpha.1", "latest")).toMatchObject({
      provider: "github",
      owner: "voidhashcom",
      repo: "lensflare",
      releaseType: "prerelease",
    });
  });
});
