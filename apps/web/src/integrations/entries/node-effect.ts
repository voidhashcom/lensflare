import type { Integration } from "../types";

/**
 * Effect-ts via the `@lensflare.dev/effect` SDK. The package is a tiny wrapper
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
    logo: "lensflare",
  },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary:
    "Provide your production observability layer normally, and swap in Lensflare's Effect SDK during local development.",
  steps: [
    {
      title: "Install the Lensflare Effect SDK",
      body: "The SDK composes Effect's built-in OTLP tracer and logger layers, so you do not need to wire exporters yourself.",
      snippet: {
        lang: "bash",
        code: "pnpm add effect @lensflare.dev/effect",
      },
    },
    {
      title: "Choose the layer for this environment",
      body: "Keep your production observability layer as-is. In development, provide `Lensflare.layer` instead so logs and spans go to your local Lensflare dataset.",
      snippet: {
        lang: "ts",
        filename: "tracing.ts",
        code: `import { Lensflare } from "@lensflare.dev/effect";
import { Layer } from "effect";

const isDevelopment = true;

const ProductionObservabilityLive = Layer.empty;

const LensflareDevLive = Lensflare.layer("{{datasetSlug}}", {
  serverOrigin: "{{serverOrigin}}",
  serviceName: "my-service",
  serviceVersion: "0.1.0",
});

export const ObservabilityLive = isDevelopment
  ? LensflareDevLive
  : ProductionObservabilityLive;
`,
      },
      note: "Replace `Layer.empty` with the observability layer your app already provides in production.",
    },
    {
      title: "Provide the selected layer",
      body: "Your application only provides `ObservabilityLive`. The environment choice stays isolated in `tracing.ts`.",
      snippet: {
        lang: "ts",
        code: `import { Effect } from "effect";
import { ObservabilityLive } from "./tracing";

const program = Effect.gen(function* () {
  yield* Effect.log("Service starting");
});

Effect.runPromise(program.pipe(Effect.provide(ObservabilityLive)));
`,
      },
    },
  ],
  verifyHint:
    "Run your Effect program in development — you'll see both logs and spans appear in this Lensflare dataset. Spans annotated with `Effect.withSpan` surface as trace entries.",
};

export default nodeEffect;
