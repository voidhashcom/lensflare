import { describe, expect, it } from "vite-plus/test";

import type { TelemetryLogField } from "~/data/logApi";

import {
  applyFieldSuggestion,
  applyOperatorSuggestion,
  applyValueSuggestion,
  extractLeadingIdent,
  extractLeadingOperator,
  findLastWhitespace,
  quoteValueIfNeeded,
  type SpliceContext,
} from "./querySplicer";
import { OPERATOR_SYNTAX, type OperatorSyntax } from "./syntax";

/**
 * Test fixture — three fields covering every kind the default-operator
 * selector cares about. No need for a full catalog here; the splicer
 * operates on a single pick at a time.
 */
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

function syntaxFor(token: string): OperatorSyntax {
  const entry = OPERATOR_SYNTAX.find((item) => item.token === token);
  if (!entry) throw new Error(`no operator with token ${token}`);
  return entry;
}

function contextFromTrailing(source: string, trailingStart: number): SpliceContext {
  return {
    source,
    trailingStart,
    trailingText: source.slice(trailingStart),
  };
}

describe("findLastWhitespace", () => {
  it("returns -1 when there's no whitespace", () => {
    expect(findLastWhitespace("leve")).toBe(-1);
  });

  it("finds the last space when multiple whitespace kinds are present", () => {
    // Space is at index 4; tab at index 2; we want the last one.
    expect(findLastWhitespace("ab\tcd ef")).toBe(5);
  });

  it("treats newline and carriage return as whitespace", () => {
    expect(findLastWhitespace("ab\ncd")).toBe(2);
    expect(findLastWhitespace("ab\rcd")).toBe(2);
  });
});

describe("extractLeadingIdent", () => {
  it("returns the empty string when the input doesn't start with an ident char", () => {
    expect(extractLeadingIdent(":info")).toBe("");
    expect(extractLeadingIdent(" level")).toBe("");
    expect(extractLeadingIdent("")).toBe("");
  });

  it("consumes dots and dashes as part of the identifier", () => {
    expect(extractLeadingIdent("attributes.http.status_code=500")).toBe(
      "attributes.http.status_code",
    );
  });

  it("stops at the operator character", () => {
    expect(extractLeadingIdent("level:info")).toBe("level");
    expect(extractLeadingIdent("status>=500")).toBe("status");
  });
});

describe("extractLeadingOperator", () => {
  it("prefers the longest token when several match", () => {
    // `!=` should win over `!`.
    const result = extractLeadingOperator("!=500");
    expect(result).not.toBeNull();
    expect(result?.token).toBe("!=");
  });

  it("matches `>=` before `>`", () => {
    expect(extractLeadingOperator(">=500")?.token).toBe(">=");
  });

  it("returns null when no operator token is at the start", () => {
    expect(extractLeadingOperator("500")).toBeNull();
    expect(extractLeadingOperator("")).toBeNull();
  });
});

describe("quoteValueIfNeeded", () => {
  it("returns barewords as-is", () => {
    expect(quoteValueIfNeeded("info")).toBe("info");
    expect(quoteValueIfNeeded("500")).toBe("500");
  });

  it("wraps values with whitespace in double quotes", () => {
    expect(quoteValueIfNeeded("multi word")).toBe('"multi word"');
  });

  it("escapes embedded quotes and backslashes", () => {
    expect(quoteValueIfNeeded('has "quote"')).toBe('"has \\"quote\\""');
    expect(quoteValueIfNeeded('back\\slash here')).toBe('"back\\\\slash here"');
  });

  it("returns an empty-string sentinel `\"\"` for empty input", () => {
    expect(quoteValueIfNeeded("")).toBe('""');
  });
});

describe("applyFieldSuggestion", () => {
  it("inserts `<path>:` for string fields when trailingText is empty", () => {
    const ctx = contextFromTrailing("", 0);
    const result = applyFieldSuggestion(ctx, messageField);
    expect(result.source).toBe("message:");
    expect(result.cursor).toBe(8);
  });

  it("inserts `<path>=` for number fields", () => {
    const ctx = contextFromTrailing("", 0);
    const result = applyFieldSuggestion(ctx, statusField);
    expect(result.source).toBe("attributes.http.status_code=");
    expect(result.cursor).toBe(28);
  });

  it("preserves earlier pills and whitespace in trailingText", () => {
    // "level:info " is an already-committed pill; trailing starts after the
    // space; user has typed "sta" in the trailing text.
    const source = "level:info sta";
    const ctx: SpliceContext = {
      source,
      trailingStart: 11,
      trailingText: "sta",
    };
    const result = applyFieldSuggestion(ctx, statusField);
    expect(result.source).toBe("level:info attributes.http.status_code=");
    expect(result.cursor).toBe(result.source.length);
  });

  it("overwrites an in-progress field prefix", () => {
    const ctx: SpliceContext = {
      source: "lev",
      trailingStart: 0,
      trailingText: "lev",
    };
    const result = applyFieldSuggestion(ctx, levelField);
    expect(result.source).toBe("level:");
    expect(result.cursor).toBe(6);
  });
});

describe("applyOperatorSuggestion", () => {
  it("appends the chosen operator token to the composing identifier", () => {
    const ctx: SpliceContext = {
      source: "level",
      trailingStart: 0,
      trailingText: "level",
    };
    const result = applyOperatorSuggestion(ctx, syntaxFor(":"));
    expect(result).not.toBeNull();
    expect(result?.source).toBe("level:");
    expect(result?.cursor).toBe(6);
  });

  it("replaces a partial operator with the chosen token", () => {
    // User typed `status!`; picks `!=`. The ident is `status`; the trailing
    // characters after the ident are discarded and replaced with `!=`.
    const ctx: SpliceContext = {
      source: "status!",
      trailingStart: 0,
      trailingText: "status!",
    };
    const result = applyOperatorSuggestion(ctx, syntaxFor("!="));
    expect(result?.source).toBe("status!=");
    expect(result?.cursor).toBe(8);
  });

  it("returns null when there is no leading identifier", () => {
    const ctx: SpliceContext = {
      source: ":foo",
      trailingStart: 0,
      trailingText: ":foo",
    };
    const result = applyOperatorSuggestion(ctx, syntaxFor(":"));
    expect(result).toBeNull();
  });
});

describe("applyValueSuggestion", () => {
  it("replaces the value prefix and appends a trailing space to commit", () => {
    const ctx: SpliceContext = {
      source: "level:i",
      trailingStart: 0,
      trailingText: "level:i",
    };
    const result = applyValueSuggestion(ctx, "info");
    expect(result).not.toBeNull();
    // Trailing space is what promotes the pill to a committed node on the
    // next parse — the consumer relies on it to drop the pill out of
    // `trailingText`.
    expect(result?.source).toBe("level:info ");
    expect(result?.cursor).toBe(result?.source.length);
  });

  it("quotes values that contain spaces", () => {
    const ctx: SpliceContext = {
      source: "message:",
      trailingStart: 0,
      trailingText: "message:",
    };
    const result = applyValueSuggestion(ctx, "error timeout");
    expect(result?.source).toBe('message:"error timeout" ');
  });

  it("preserves earlier pills when splicing a value", () => {
    const source = "level:info status>=";
    const ctx: SpliceContext = {
      source,
      trailingStart: 11,
      trailingText: "status>=",
    };
    const result = applyValueSuggestion(ctx, "500");
    expect(result?.source).toBe("level:info status>=500 ");
  });

  it("returns null when there is no operator in the composing chunk", () => {
    const ctx: SpliceContext = {
      source: "level",
      trailingStart: 0,
      trailingText: "level",
    };
    const result = applyValueSuggestion(ctx, "info");
    expect(result).toBeNull();
  });

  it("returns null when there is no identifier", () => {
    const ctx: SpliceContext = {
      source: ":info",
      trailingStart: 0,
      trailingText: ":info",
    };
    const result = applyValueSuggestion(ctx, "info");
    expect(result).toBeNull();
  });
});
