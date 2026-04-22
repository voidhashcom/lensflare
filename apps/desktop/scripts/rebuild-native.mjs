import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const sqlitePackagePath = require.resolve("@effect/sql-sqlite-node/package.json");
const betterSqlitePackagePath = require.resolve("better-sqlite3/package.json", {
  paths: [dirname(sqlitePackagePath)],
});
const betterSqliteBuildDir = resolve(dirname(betterSqlitePackagePath), "build");

// electron-builder updates .forge-meta here without replacing stale binaries in this
// workspace layout, so drop the previous build before forcing the Electron rebuild.
await rm(betterSqliteBuildDir, { recursive: true, force: true });

const env = {
  ...process.env,
  npm_config_build_from_source: "true",
};

delete env.ELECTRON_RUN_AS_NODE;

const command = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";

await new Promise((resolvePromise, rejectPromise) => {
  const child = spawn(command, ["install-app-deps"], {
    env,
    stdio: "inherit",
  });

  child.on("error", rejectPromise);
  child.on("exit", (code, signal) => {
    if (code === 0) {
      resolvePromise();
      return;
    }

    rejectPromise(
      new Error(
        signal
          ? `electron-builder install-app-deps terminated with signal ${signal}`
          : `electron-builder install-app-deps exited with code ${code ?? "unknown"}`,
      ),
    );
  });
});
