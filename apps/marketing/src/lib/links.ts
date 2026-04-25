/**
 * Canonical external links referenced from the marketing site. Centralised so
 * renaming the repo or moving the release channel is a one-file edit.
 */
export const GITHUB_REPO =
  import.meta.env.LENSFLARE_DESKTOP_UPDATE_REPOSITORY ??
  import.meta.env.PUBLIC_LENSFLARE_DESKTOP_UPDATE_REPOSITORY ??
  "voidhashcom/lensflare";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`;
export const GITHUB_LATEST_RELEASE_URL = `${GITHUB_REPO_URL}/releases/latest`;
/** All releases — used by /download for the "View changelog" pill and the older-versions link. */
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`;
