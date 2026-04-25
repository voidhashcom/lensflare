/**
 * Stringify a value for storage in a `JSON`-typed DuckDB column,
 * collapsing both `null` and `undefined` to a SQL `NULL`.
 *
 * Used by every provider's normalization layer — keeps the
 * "absence of a value" representation identical across providers
 * so downstream analytics don't have to special-case the source.
 */
export function jsonStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}
