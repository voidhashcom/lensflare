import type { Integration } from "../types";

/**
 * Effect-ts via the `@lensflare/effect` SDK. The package is a tiny wrapper
 * over Effect's built-in OTLP tracer/logger layers and only enables itself in
 * development by default.
 *
 * The snippet intentionally mirrors our internal layer as closely as
 * possible so that a user who copies it into a fresh service ends up with
 * the same shape of batch processors and shutdown hooks Lensflare uses.
 */
const nodeEffect: Integration = {
  id: "node-effect",
  language: "effect",
  library: {
    id: "lensflare-effect",
    label: "Lensflare Effect SDK",
    homepageUrl: "https://github.com/voidhashcom/lensflare",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary: "Wire Effect's built-in telemetry into Lensflare with one development-only layer.",
  steps: [
    {
      title: "Install the Lensflare Effect SDK",
      body: "The SDK composes Effect's built-in OTLP tracer and logger layers, so you do not need to wire exporters yourself.",
      snippet: {
        lang: "bash",
        code: "pnpm add effect @lensflare/effect",
      },
    },
    {
      title: "Provide `Lensflare.layer`",
      body: "`Lensflare.layer` returns an Effect layer you can compose into your main program. It sends logs and traces to your local Lensflare server in development and becomes empty in production.",
      snippet: {
        lang: "ts",
        filename: "tracing.ts",
        code: `import { Lensflare } from "@lensflare/effect";

export const ObservabilityLive = Lensflare.layer("{{datasetSlug}}", {
  serviceName: "my-service",
  serviceVersion: "0.1.0",
});
`,
      },
      note: "Use `LENSFLARE_ENABLED=1` to force it on or `LENSFLARE_ENABLED=0` to force it off.",
    },
    {
      title: "Provide the layer to your program",
      body: "Once `TracingLive` is merged in, every `Effect.log`, `Effect.withSpan`, and `Effect.annotateLogs` call becomes a record in Lensflare. No other code changes are needed.",
      snippet: {
        lang: "ts",
        code: `import { Effect, Layer } from "effect";
import { ObservabilityLive } from "./tracing";

const program = Effect.gen(function* () {
  yield* Effect.log("Service starting");

  yield* Effect.withSpan("handle-request")(
    Effect.gen(function* () {
      yield* Effect.annotateLogs({ userId: "42" });
      yield* Effect.log("Processing request");
    }),
  );
});

Effect.runPromise(program.pipe(Effect.provide(ObservabilityLive)));
`,
      },
    },
  ],
  verifyHint:
    "Run your Effect program — you'll see both logs and spans appear. Spans annotated with `Effect.withSpan` surface as trace entries in the dataset.",
};

export default nodeEffect;
