# Lensflare

Lensflare is a local observability workspace for inspecting logs and traces while you build. It includes a web UI, a local server, a desktop app, and a small Effect SDK that sends development telemetry to your local Lensflare dataset.

## Quick Start

Install dependencies:

```bash
pnpm install
```

Run the local server and web app:

```bash
pnpm dev
```

Run the desktop app:

```bash
pnpm dev:desktop
```

Build and test:

```bash
pnpm build
pnpm test
```

## Effect SDK

The first public package is `@lensflare/effect`, an Effect layer for sending logs and traces to Lensflare during local development.

```bash
pnpm add effect @lensflare/effect
```

```ts
import { Effect } from "effect";
import { Lensflare } from "@lensflare/effect";

const program = Effect.gen(function* () {
  yield* Effect.log("hello from Lensflare");
});

Effect.runPromise(program.pipe(Effect.provide(Lensflare.layer("dev"))));
```

See [packages/effect](./packages/effect) for package documentation.

## Development

This repository uses Node 24 and pnpm 10. The main workspace commands are:

```bash
pnpm dev
pnpm dev:web
pnpm dev:server
pnpm dev:desktop
pnpm check
pnpm typecheck
pnpm test
pnpm build
```

Before writing Effect code, consult the local Effect guidance described in [AGENTS.md](./AGENTS.md).

## Releases

Desktop app releases are published through GitHub Releases. Package releases are managed with Changesets and published to NPM.

- [GitHub Releases](https://github.com/voidhashcom/lensflare/releases)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [License](./LICENSE)
