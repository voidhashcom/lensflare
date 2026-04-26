import { GITHUB_LATEST_RELEASE_URL, GITHUB_RELEASES_URL, GITHUB_REPO } from "./links";

interface GitHubReleaseAsset {
  readonly name: string;
  readonly browser_download_url: string;
}

interface GitHubRelease {
  readonly tag_name: string;
  readonly html_url: string;
  readonly assets: readonly GitHubReleaseAsset[];
}

export interface DownloadLink {
  readonly href: string;
  readonly available: boolean;
}

export interface LatestReleaseDownloads {
  readonly available: boolean;
  readonly versionLabel: string;
  readonly releaseUrl: string;
  readonly downloads: {
    readonly macArm64: DownloadLink;
    readonly macX64: DownloadLink;
  };
}

const fallbackDownloadLink: DownloadLink = {
  href: GITHUB_LATEST_RELEASE_URL,
  available: false,
};

const fallbackReleaseDownloads: LatestReleaseDownloads = {
  available: false,
  versionLabel: "Latest release",
  releaseUrl: GITHUB_RELEASES_URL,
  downloads: {
    macArm64: fallbackDownloadLink,
    macX64: fallbackDownloadLink,
  },
};

const findAssetUrl = (assets: readonly GitHubReleaseAsset[], suffix: string): DownloadLink => {
  const asset = assets.find((candidate) => candidate.name.endsWith(suffix));

  return asset
    ? {
        href: asset.browser_download_url,
        available: true,
      }
    : fallbackDownloadLink;
};

const createGitHubHeaders = (): Headers => {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const token = import.meta.env.GITHUB_TOKEN;

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
};

const fetchJson = async <T>(url: string, headers: Headers): Promise<T | null> => {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as T;
};

const fetchLatestRelease = async (): Promise<GitHubRelease | null> => {
  const headers = createGitHubHeaders();
  const latestRelease = await fetchJson<GitHubRelease>(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    headers,
  );

  if (latestRelease) {
    return latestRelease;
  }

  const releases = await fetchJson<readonly GitHubRelease[]>(
    `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`,
    headers,
  );

  return releases?.[0] ?? null;
};

export async function getLatestReleaseDownloads(): Promise<LatestReleaseDownloads> {
  try {
    const release = await fetchLatestRelease();

    if (!release) {
      return fallbackReleaseDownloads;
    }

    const assets = release.assets ?? [];

    return {
      available: true,
      versionLabel: release.tag_name || fallbackReleaseDownloads.versionLabel,
      releaseUrl: release.html_url || GITHUB_RELEASES_URL,
      downloads: {
        macArm64: findAssetUrl(assets, "-arm64.dmg"),
        macX64: findAssetUrl(assets, "-x64.dmg"),
      },
    };
  } catch {
    return fallbackReleaseDownloads;
  }
}
