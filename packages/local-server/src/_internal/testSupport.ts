import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, type Layer } from "effect";

/**
 * Run an Effect against a fresh temp-dir-backed dependency layer, deleting
 * the directory afterwards even if the program fails.
 *
 * The factory takes the absolute path of a per-test SQLite file inside the
 * temp directory, so each test gets a clean database that exercises real
 * migrations from scratch.
 */
export function withTempDirectory<A, E, R, LE>(
  buildLayer: (databaseFile: string) => Layer.Layer<R, LE, never>,
  program: Effect.Effect<A, E, R>,
  prefix = "lensflare-local-server-",
): Effect.Effect<A, E | LE> {
  return Effect.acquireUseRelease(
    Effect.tryPromise(() => mkdtemp(join(tmpdir(), prefix))).pipe(Effect.orDie),
    (directory) =>
      program.pipe(Effect.provide(buildLayer(join(directory, "catalog.sqlite")))),
    (directory) =>
      Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );
}
