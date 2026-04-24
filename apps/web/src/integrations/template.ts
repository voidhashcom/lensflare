import type { TemplateVars } from "./types";

/**
 * Matches `{{identifier}}` placeholders in snippet source. The identifier
 * must be plain ASCII (`A-Z`, `a-z`, `0-9`, `_`) so we don't accidentally
 * swallow unrelated double braces in source (e.g. Go or Rust generics).
 */
const PLACEHOLDER_PATTERN = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/**
 * Substitute `{{varName}}` placeholders in a snippet's source with values
 * from {@link TemplateVars}.
 *
 * Unknown placeholders are left untouched rather than replaced with an
 * empty string so authors can spot mistyped names in the rendered output.
 * Consumers that want strict behaviour should pass `onMissing` to observe
 * missing vars without changing the return value shape.
 */
export function renderTemplate(
  source: string,
  vars: TemplateVars,
  onMissing?: (name: string) => void,
): string {
  return source.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    if (Object.hasOwn(vars, name)) {
      return String(vars[name as keyof TemplateVars]);
    }

    onMissing?.(name);
    return match;
  });
}

/**
 * Collect the set of placeholder names referenced in a template string.
 * Useful for debugging and for test coverage (every entry should only use
 * placeholders that `TemplateVars` declares).
 */
export function collectPlaceholders(source: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return names;
}
