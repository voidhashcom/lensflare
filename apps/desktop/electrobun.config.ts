import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Lensflare",
    identifier: "dev.lensflare.app",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    mac: {
      bundleCEF: true,
    },
    linux: {
      bundleCEF: true,
    },
    win: {
      bundleCEF: true,
    },
  },
  scripts: {
    postBuild: "./scripts/post-build.ts",
  },
} satisfies ElectrobunConfig;
