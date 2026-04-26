# @lensflare.dev/effect

Effect observability layer for Lensflare local logs and traces.

## Install

```bash
pnpm add effect @lensflare.dev/effect
```

`@lensflare.dev/effect` follows Effect's version. Install matching versions unless a Lensflare-only hotfix release notes says otherwise.

For example:

```bash
pnpm add effect@4.0.0-beta.55 @lensflare.dev/effect@4.0.0-beta.55
```

Lensflare-only emergency fixes use versions that still identify their target Effect release. During Effect beta releases, `4.0.0-beta.55-lensflare.1` targets `effect@4.0.0-beta.55`. For stable Effect releases, Lensflare hotfixes use the next patch version and keep the exact compatible Effect version in `peerDependencies`.

## Usage

```ts
import { Effect } from "effect";
import { Lensflare } from "@lensflare.dev/effect";

const program = Effect.gen(function* () {
  yield* Effect.log("hello from Lensflare");
});

Effect.runPromise(program.pipe(Effect.provide(Lensflare.layer("dev"))));
```

`Lensflare.layer(datasetSlug, options)` composes Effect's OTLP logger and tracer layers and points them at a local Lensflare server. The layer enables itself by default outside production.

## Options

- `enabled`: force the layer on or off.
- `env`: provide an explicit environment map instead of reading `process.env`.
- `environment`: override environment detection.
- `serverOrigin`: Lensflare server origin. Defaults to `http://127.0.0.1:43110`.
- `serviceName`: service name resource attribute. Defaults to `app`.
- `serviceVersion`: optional service version resource attribute.
- `resourceAttributes`: additional resource attributes.
- `exportInterval`: OTLP export interval.
- `maxBatchSize`: maximum OTLP batch size.
- `shutdownTimeout`: OTLP shutdown timeout.
- `mergeWithExistingLogger`: merge with an existing logger layer. Defaults to `true`.

## Environment Variables

- `LENSFLARE_ENABLED`: force telemetry on or off. Accepts `1`, `true`, `yes`, `on`, `0`, `false`, `no`, or `off`.
- `LENSFLARE_DEV`: enables Lensflare in development-style environments.
- `LENSFLARE_ORIGIN`: Lensflare server origin.
- `LENSFLARE_SERVER_ORIGIN`: alternate Lensflare server origin.
- `OTEL_SERVICE_NAME`: service name.
- `OTEL_SERVICE_VERSION`: service version.

## API

```ts
import { Lensflare, layer, isEnabled, resolveLayerConfig } from "@lensflare.dev/effect";
```

The package is ESM-only and publishes TypeScript declarations.
