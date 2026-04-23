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

const catalog: ReadonlyArray<TelemetryLogField> = [
  levelField,
  messageField,
  statusField,
];

const noop = () => {};

function render(
  props: Partial<Parameters<typeof FilterQueryInput>[0]> = {},
): string {
  const defaults: Parameters<typeof FilterQueryInput>[0] = {
    projectId: "p",
    datasetId: "d",
    fields: catalog,
    onFilterChange: noop,
  };
  return renderToStaticMarkup(<FilterQueryInput {...defaults} {...props} />);
}

describe("FilterQueryInput — initial render", () => {
  it("renders the placeholder and search icon when empty", () => {
    const html = render();

    expect(html).toContain("Filter logs");
    // lucide icons render as SVG, which we can sniff via the lucide class.
    expect(html).toContain("lucide-search");
  });

  it("exposes the combobox role and aria-haspopup", () => {
    const html = render();

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
  });

  it("doesn't show the Clear-all button when there is nothing to clear", () => {
    const html = render();

    expect(html).not.toContain('aria-label="Clear filters"');
  });

  it("renders without throwing when the catalog is empty", () => {
    expect(() => render({ fields: [] })).not.toThrow();
  });
});
