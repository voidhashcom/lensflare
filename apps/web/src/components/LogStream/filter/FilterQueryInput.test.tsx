import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { TelemetryLogField } from "~/data/logApi";

import { FilterQueryInput } from "./FilterQueryInput";

const levelField: TelemetryLogField = {
  path: ["level"],
  label: "Level",
  kind: "enum",
  values: ["info", "warn", "error"],
};

const messageField: TelemetryLogField = {
  path: ["message"],
  label: "Message",
  kind: "string",
};

const statusField: TelemetryLogField = {
  path: ["attributes", "http", "status_code"],
  label: "http.status_code",
  kind: "number",
};

const catalog: ReadonlyArray<TelemetryLogField> = [levelField, messageField, statusField];

const noop = () => {};

function render(props: Partial<Parameters<typeof FilterQueryInput>[0]> = {}): string {
  const defaults: Parameters<typeof FilterQueryInput>[0] = {
    projectId: "p",
    datasetId: "d",
    fields: catalog,
    appliedSource: "",
    onAppliedSourceChange: noop,
  };
  return renderToStaticMarkup(<FilterQueryInput {...defaults} {...props} />);
}

describe("FilterQueryInput — initial render", () => {
  it("renders the placeholder and search icon when empty", () => {
    const html = render();

    expect(html).toContain("Filter telemetry");
    // lucide icons render as SVG, which we can sniff via the lucide class.
    expect(html).toContain("lucide-search");
  });

  it("renders the spotlight trigger", () => {
    const html = render();

    expect(html).toContain('aria-label="Open telemetry filter"');
    expect(html).toContain('data-slot="filter-query-input"');
    expect(html).toContain("K");
  });

  it("doesn't show the Clear-all button when there is nothing to clear", () => {
    const html = render();

    expect(html).not.toContain('aria-label="Clear filters"');
  });

  it("renders without throwing when the catalog is empty", () => {
    expect(() => render({ fields: [] })).not.toThrow();
  });

  it("renders the controlled applied source in the trigger", () => {
    const html = render({ appliedSource: 'level = "error" ' });

    // The applied filter is rendered as three adjacent pill spans (field /
    // operator / value) so the trigger can colour the parts independently.
    expect(html).toContain("filter-query-pill--field");
    expect(html).toContain("filter-query-pill--operator");
    expect(html).toContain("filter-query-pill--value");
    expect(html).toContain(">level<");
    expect(html).toContain(">=<");
    expect(html).toContain("&quot;error&quot;");
    expect(html).toContain('aria-label="Clear filters"');
  });

  it("renders a final applied filter as a pill without requiring trailing whitespace", () => {
    const html = render({ appliedSource: 'level = "error" message = "timeout"' });

    expect(html).toContain("filter-query-pill--field");
    expect(html).toContain(">level<");
    expect(html).toContain("&quot;error&quot;");
    expect(html).toContain(">message<");
    expect(html).toContain("&quot;timeout&quot;");
    expect(html).not.toContain("text-muted-foreground italic");
  });
});
