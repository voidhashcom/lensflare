import type { Integration } from "../types";

/**
 * Pino → Axiom-native ingest via `pino-axiom`'s transport. This is the
 * shortest path from "I already use pino" to "my logs are in Lensflare",
 * so it's worth showing as a first-class library option even though the
 * user could also just pipe pino JSON into OTLP with a bridge.
 */
const nodePino: Integration = {
  id: "node-pino",
  language: "node",
  library: {
    id: "pino",
    label: "Pino",
    homepageUrl: "https://getpino.io/",
  },
  protocol: "axiom-native",
  signals: ["logs"],
  summary:
    "Stream structured logs from pino straight into Lensflare using the Axiom-compatible transport.",
  steps: [
    {
      title: "Install pino + the pino-axiom transport",
      body: "`pino-axiom` is a thin transport that POSTs NDJSON to the Axiom ingest endpoint. Lensflare speaks the same protocol, so we just redirect it at the local server.",
      snippet: {
        lang: "bash",
        code: "npm install pino pino-axiom",
      },
    },
    {
      title: "Configure the transport to target Lensflare",
      body: "The transport takes three options: a dataset, a bearer token, and the base URL. In Lensflare, the bearer token is your project slug.",
      snippet: {
        lang: "ts",
        filename: "logger.ts",
        code: `import pino from "pino";

export const logger = pino({
  transport: {
    target: "pino-axiom",
    options: {
      dataset: "{{datasetSlug}}",
      token: "{{bearerToken}}",
      orgId: "lensflare",
      axiomUrl: "{{serverOrigin}}",
    },
  },
});
`,
      },
    },
    {
      title: "Log something",
      body: "Any pino call will land in the live tab. Structured fields are preserved and become searchable.",
      snippet: {
        lang: "ts",
        code: `import { logger } from "./logger";

logger.info(
  { userId: "42", route: "/checkout" },
  "Customer started checkout",
);

logger.error(
  { err: new Error("Payment declined") },
  "Checkout failed",
);
`,
      },
      note: "pino buffers writes — you may see a short delay before the first batch arrives.",
    },
  ],
  verifyHint:
    "Once events arrive, click a log entry to see the structured fields pino attached.",
};

export default nodePino;
