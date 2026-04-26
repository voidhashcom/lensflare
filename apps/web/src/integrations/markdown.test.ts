import { describe, expect, it } from "vite-plus/test";

import { integrationToMarkdown } from "./markdown";
import type { Integration, TemplateVars } from "./types";

const VARS: TemplateVars = {
  projectSlug: "demo",
  datasetSlug: "logs",
  serverOrigin: "http://127.0.0.1:43110",
  bearerToken: "demo",
};

const BASE_INTEGRATION: Integration = {
  id: "node-effect",
  language: "effect",
  library: { id: "lensflare-effect", label: "Lensflare Effect SDK" },
  protocol: "otlp-http",
  signals: ["logs", "traces"],
  summary: "Wire Effect's built-in telemetry into Lensflare.",
  steps: [
    {
      title: "Install the SDK",
      body: "Adds the wrapper plus its peer.",
      snippet: {
        lang: "bash",
        code: "pnpm add @lensflare.dev/effect",
      },
    },
    {
      title: "Provide the layer",
      body: "Compose the layer into your program.",
      snippet: {
        lang: "ts",
        filename: "tracing.ts",
        code: 'import { Lensflare } from "@lensflare.dev/effect";\n\nexport const Live = Lensflare.layer("{{datasetSlug}}");\n',
      },
      note: "Use `LENSFLARE_ENABLED=1` to force it on.",
    },
  ],
  verifyHint: "Run your program — events should land within seconds.",
};

describe("integrationToMarkdown", () => {
  it("renders the heading from the language label and library label", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS, {
      languageLabel: "Effect",
    });
    expect(md.startsWith("# Effect + Lensflare Effect SDK\n")).toBe(true);
  });

  it("falls back to the raw language id when no label is provided", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS);
    expect(md.startsWith("# effect + Lensflare Effect SDK\n")).toBe(true);
  });

  it("includes the summary, protocol label, and signal list", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS, {
      languageLabel: "Effect",
    });
    expect(md).toContain("Wire Effect's built-in telemetry into Lensflare.");
    expect(md).toContain("**Protocol:** OTLP HTTP · **Signals:** logs, traces");
  });

  it("numbers steps and emits fenced code blocks tagged with the snippet language", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS, {
      languageLabel: "Effect",
    });
    expect(md).toContain("## 1. Install the SDK");
    expect(md).toContain("## 2. Provide the layer");
    expect(md).toContain("```bash\npnpm add @lensflare.dev/effect\n```");
    expect(md).toContain("```ts\nimport");
  });

  it("substitutes template placeholders inside snippet bodies", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS, {
      languageLabel: "Effect",
    });
    expect(md).toContain('Lensflare.layer("logs")');
    expect(md).not.toContain("{{datasetSlug}}");
  });

  it("renders snippet filenames as italic labels above the fence", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS, {
      languageLabel: "Effect",
    });
    expect(md).toContain("*tracing.ts*\n\n```ts\n");
  });

  it("renders notes as blockquotes", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS, {
      languageLabel: "Effect",
    });
    expect(md).toContain("> Use `LENSFLARE_ENABLED=1` to force it on.");
  });

  it("renders multi-line notes as multi-line blockquotes so paragraph breaks stay quoted", () => {
    const integration: Integration = {
      ...BASE_INTEGRATION,
      steps: [
        {
          title: "Step",
          note: "First line.\nSecond line.",
        },
      ],
    };
    const md = integrationToMarkdown(integration, VARS);
    expect(md).toContain("> First line.\n> Second line.");
  });

  it("appends a horizontal rule and the verify hint when one is set", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS, {
      languageLabel: "Effect",
    });
    expect(md).toContain("\n---\n\nRun your program — events should land within seconds.\n");
  });

  it("omits the verify hint section when none is set", () => {
    const { verifyHint: _omitted, ...rest } = BASE_INTEGRATION;
    const integration: Integration = rest;
    const md = integrationToMarkdown(integration, VARS);
    expect(md).not.toContain("---");
    expect(md).not.toContain("Run your program");
  });

  it("ends with a single trailing newline", () => {
    const md = integrationToMarkdown(BASE_INTEGRATION, VARS);
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
  });

  it("falls back to the raw protocol id when no label is registered", () => {
    const { verifyHint: _omitted, ...rest } = BASE_INTEGRATION;
    const integration: Integration = {
      ...rest,
      protocol: "made-up" as unknown as Integration["protocol"],
      steps: [],
    };
    const md = integrationToMarkdown(integration, VARS);
    expect(md).toContain("**Protocol:** made-up");
  });
});
