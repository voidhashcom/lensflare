/**
 * Parse a wire-format timestamp into an ISO-8601 UTC string.
 *
 * Accepts the union of formats every supported provider can emit:
 *   • `number` — milliseconds since the Unix epoch (Axiom-style `time` numerics).
 *   • RFC 3339 / ISO-8601 string (e.g. `"2025-01-02T03:04:05.678Z"`).
 *   • All-digits string — interpreted as Unix nanoseconds via `BigInt`,
 *     truncated to milliseconds before constructing the `Date` (OTLP wire
 *     format uses `time_unix_nano` encoded as a fixed64).
 *
 * Returns `null` for anything else (missing field, empty string, NaN, etc.) so
 * downstream code can distinguish "absent" from "valid zero".
 */
export function parseTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.length > 0) {
    if (/^\d+$/.test(value)) {
      try {
        const asMs = Number(BigInt(value) / 1_000_000n);
        return new Date(asMs).toISOString();
      } catch {
        return null;
      }
    }

    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  return null;
}
