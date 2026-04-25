/**
 * Canonical external links referenced from the marketing site. Centralised so
 * renaming the repo or moving the release channel is a one-file edit.
 */
export const GITHUB_REPO_URL = "https://github.com/voidhashcom/lensflare";
export const GITHUB_LATEST_RELEASE_URL = `${GITHUB_REPO_URL}/releases/latest`;
/** All releases — used by /download for the "View changelog" pill and the older-versions link. */
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;

/**
 * The currently-published Lensflare version. Surfaced on /download in the
 * "Latest" pill so visitors know what they're getting before clicking through
 * to GitHub. Bump on every release so the marketing page reflects what
 * GitHub actually serves.
 */
export const LATEST_VERSION = "v0.4.2";
