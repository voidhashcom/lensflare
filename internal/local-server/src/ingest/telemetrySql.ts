import type { DuckDBValue } from "@duckdb/node-api";

export interface SqlFragment {
  readonly sql: string;
  readonly params: Record<string, DuckDBValue>;
}

export function mapLiteral(
  prefix: string,
  attributes: Readonly<Record<string, string>>,
): SqlFragment {
  const params: Record<string, DuckDBValue> = {};
  const keys: Array<string> = [];
  const values: Array<string> = [];
  let index = 0;

  for (const [key, value] of Object.entries(attributes)) {
    const keyParam = `${prefix}_k_${index}`;
    const valueParam = `${prefix}_v_${index}`;
    params[keyParam] = key;
    params[valueParam] = value;
    keys.push(`$${keyParam}`);
    values.push(`$${valueParam}`);
    index += 1;
  }

  return {
    sql: `map([${keys.join(", ")}], [${values.join(", ")}])`,
    params,
  };
}

export function stringArrayLiteral(prefix: string, values: ReadonlyArray<string>): SqlFragment {
  const params: Record<string, DuckDBValue> = {};
  const items = values.map((value, index) => {
    const key = `${prefix}_${index}`;
    params[key] = value;
    return `$${key}`;
  });
  return { sql: `[${items.join(", ")}]`, params };
}

export function timestampArrayLiteral(prefix: string, values: ReadonlyArray<string>): SqlFragment {
  const params: Record<string, DuckDBValue> = {};
  const items = values.map((value, index) => {
    const key = `${prefix}_${index}`;
    params[key] = value;
    return `CAST($${key} AS TIMESTAMP_NS)`;
  });
  return { sql: `[${items.join(", ")}]`, params };
}

export function mapArrayLiteral(
  prefix: string,
  values: ReadonlyArray<Readonly<Record<string, string>>>,
): SqlFragment {
  const params: Record<string, DuckDBValue> = {};
  const items = values.map((value, index) => {
    const fragment = mapLiteral(`${prefix}_${index}`, value);
    Object.assign(params, fragment.params);
    return fragment.sql;
  });
  return { sql: `[${items.join(", ")}]`, params };
}

export function mergeFragments(
  ...fragments: ReadonlyArray<SqlFragment>
): Record<string, DuckDBValue> {
  return Object.assign({}, ...fragments.map((fragment) => fragment.params));
}
