import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const buildDir = process.env.ELECTROBUN_BUILD_DIR;

if (!buildDir) {
  throw new Error("ELECTROBUN_BUILD_DIR is not set");
}

const currentDir = dirname(fileURLToPath(import.meta.url));
const webDistDir = resolve(currentDir, "../../web/dist");
const targetDir = join(buildDir, "app", "web");

if (!existsSync(webDistDir)) {
  throw new Error(`Expected built web assets at ${webDistDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(dirname(targetDir), { recursive: true });
cpSync(webDistDir, targetDir, { recursive: true });

console.log(`[lensflare] copied web assets to ${targetDir}`);
