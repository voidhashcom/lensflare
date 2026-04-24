import { describe, expect, it } from "vite-plus/test";

import { collectPlaceholders, renderTemplate } from "./template";
import type { TemplateVars } from "./types";

const vars: TemplateVars = {
  projectSlug: "demo",
  datasetSlug: "logs",
  serverOrigin: "http://127.0.0.1:43110",
  bearerToken: "demo",
};

describe("renderTemplate", () => {
  it("substitutes known placeholders", () => {
    const out = renderTemplate(
      "curl {{serverOrigin}}/ingest/axiom/v1/ingest/{{datasetSlug}}",
      vars,
    );
    expect(out).toBe("curl http://127.0.0.1:43110/ingest/axiom/v1/ingest/logs");
  });

  it("substitutes every occurrence of the same placeholder", () => {
    const out = renderTemplate("{{projectSlug}} / {{projectSlug}}", vars);
    expect(out).toBe("demo / demo");
  });

  it("leaves unknown placeholders untouched so typos are visible", () => {
    const out = renderTemplate("hello {{unknownVar}} world", vars);
    expect(out).toBe("hello {{unknownVar}} world");
  });

  it("notifies the caller about missing placeholders", () => {
    const missing: Array<string> = [];
    renderTemplate("{{projectSlug}} + {{nope}}", vars, (name) => {
      missing.push(name);
    });
    expect(missing).toEqual(["nope"]);
  });

  it("ignores double braces with non-identifier payloads", () => {
    // Important for Go / Rust / Handlebars-adjacent code where `{{` is a
    // legitimate character sequence and must not be greedy-matched.
    const src = "let x: Vec<{{i32}}> = vec![{{1, 2}}];";
    expect(renderTemplate(src, vars)).toBe(src);
  });
});

describe("collectPlaceholders", () => {
  it("returns the unique set of referenced names", () => {
    const names = collectPlaceholders(
      "{{projectSlug}}/{{datasetSlug}}?token={{projectSlug}}",
    );
    expect([...names].sort()).toEqual(["datasetSlug", "projectSlug"]);
  });

  it("returns an empty set when there are no placeholders", () => {
    expect(collectPlaceholders("no placeholders here").size).toBe(0);
  });
});
