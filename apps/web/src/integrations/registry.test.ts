import { describe, expect, it } from "vite-plus/test";

import { createRegistry } from "./registry";
import type { Integration } from "./types";

const makeIntegration = (overrides: Partial<Integration> & Pick<Integration, "id" | "language" | "library">): Integration => ({
  protocol: "otlp-http",
  signals: ["logs"],
  summary: "",
  steps: [],
  ...overrides,
});

const NODE_OTEL = makeIntegration({
  id: "node-opentelemetry",
  language: "node",
  library: { id: "opentelemetry-sdk", label: "OpenTelemetry SDK" },
});
const NODE_PINO = makeIntegration({
  id: "node-pino",
  language: "node",
  library: { id: "pino", label: "pino" },
  protocol: "axiom-native",
});
const PYTHON_OTEL = makeIntegration({
  id: "python-opentelemetry",
  language: "python",
  library: { id: "opentelemetry-sdk", label: "OpenTelemetry SDK" },
});
const SHELL_CURL = makeIntegration({
  id: "shell-curl",
  language: "shell",
  library: { id: "curl", label: "curl" },
  protocol: "curl",
});

describe("createRegistry", () => {
  it("returns entries sorted by id from listAll()", () => {
    const registry = createRegistry([NODE_PINO, SHELL_CURL, NODE_OTEL]);
    expect(registry.listAll().map((i) => i.id)).toEqual([
      "node-opentelemetry",
      "node-pino",
      "shell-curl",
    ]);
  });

  it("lists only languages that have at least one entry, in canonical order", () => {
    const registry = createRegistry([SHELL_CURL, PYTHON_OTEL, NODE_OTEL]);
    // Canonical order is node, effect, python, go, browser, shell — so we
    // expect node/python/shell to appear in that order even though the
    // registry was built shell-first.
    expect(registry.listLanguages().map((meta) => meta.id)).toEqual([
      "node",
      "python",
      "shell",
    ]);
  });

  it("lists libraries for a language sorted by display label", () => {
    const registry = createRegistry([NODE_PINO, NODE_OTEL]);
    expect(registry.listLibraries("node").map((lib) => lib.label)).toEqual([
      "OpenTelemetry SDK",
      "pino",
    ]);
  });

  it("find() returns the matching integration for a language+library pair", () => {
    const registry = createRegistry([NODE_OTEL, NODE_PINO, PYTHON_OTEL]);
    expect(
      registry.find({ language: "node", libraryId: "pino" })?.id,
    ).toBe("node-pino");
  });

  it("find() returns undefined when the library is not registered for that language", () => {
    const registry = createRegistry([NODE_OTEL]);
    expect(
      registry.find({ language: "node", libraryId: "pino" }),
    ).toBeUndefined();
    expect(
      registry.find({ language: "python", libraryId: "opentelemetry-sdk" }),
    ).toBeUndefined();
  });

  it("getDefault() prefers Node + OpenTelemetry SDK when available", () => {
    const registry = createRegistry([PYTHON_OTEL, NODE_OTEL, SHELL_CURL]);
    expect(registry.getDefault()?.id).toBe("node-opentelemetry");
  });

  it("getDefault() falls back to the first sorted entry when Node+OTel is missing", () => {
    const registry = createRegistry([SHELL_CURL, PYTHON_OTEL]);
    expect(registry.getDefault()?.id).toBe("python-opentelemetry");
  });

  it("getDefault() returns undefined for an empty registry", () => {
    expect(createRegistry([]).getDefault()).toBeUndefined();
  });

  it("surfaces unknown languages after the canonical ones so nothing is silently dropped", () => {
    const exotic = makeIntegration({
      id: "ruby-axiom",
      // Cast so the test stays useful even if we tighten the Language union
      // before adding Ruby to the canonical order.
      language: "ruby" as unknown as Integration["language"],
      library: { id: "axiom-rb", label: "axiom-rb" },
    });
    const registry = createRegistry([exotic, NODE_OTEL]);
    expect(registry.listLanguages().map((meta) => meta.id)).toEqual([
      "node",
      "ruby",
    ]);
  });
});
