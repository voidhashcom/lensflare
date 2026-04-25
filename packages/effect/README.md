# @lensflare/effect

Effect observability layer for Lensflare local logs and traces.

## Install

```bash
pnpm add effect @lensflare/effect
```

## Usage

```ts
import { Effect } from "effect";
import { Lensflare } from "@lensflare/effect";

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
import { Lensflare, layer, isEnabled, resolveLayerConfig } from "@lensflare/effect";
```

The package is ESM-only and publishes TypeScript declarations.
