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

/** Public docs page that the plugin manifests, the in-app MCP tab, and the first-launch toast all link to. */
export const DOCS_MCP_URL = "https://lensflare.dev/docs/mcp";
/**
 * GitHub slug Claude Code / Cursor / Codex marketplaces resolve when a user
 * runs `/plugin marketplace add <repo>`. Mirrors `GITHUB_REPO`.
 */
export const PLUGIN_MARKETPLACE_REPO = GITHUB_REPO;
export const PLUGIN_MARKETPLACE_URL = `https://github.com/${PLUGIN_MARKETPLACE_REPO}`;
