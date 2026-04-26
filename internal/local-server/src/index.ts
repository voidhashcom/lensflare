/**
 * Public entry point for `@lensflare/local-server`.
 *
 * Internal modules (`./catalog/*`, `./db/*`, `./http/*`) are only imported by
 * other files in this package and by test code. Anything consumed by external
 * packages (the desktop shell, the CLI, etc.) must be re-exported here.
 */
export {
  type LocalServerHandle,
  type StartLocalServerOptions,
  startLocalServer,
} from "./server.ts";
export { LensflareMcpToolsLayer } from "./mcp/server.ts";
export {
  DEFAULT_APP_SETTINGS,
  mergeAppSettings,
  readHashedAnalyticsDistinctId,
  readPersistedAppSettings,
  resolveAnalyticsBootstrap,
  resolveLocalAppStatePaths,
  writePersistedAppSettings,
} from "./appSettings.ts";
