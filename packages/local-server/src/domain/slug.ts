const NON_ASCII_MARKS = /[\u0300-\u036f]/g;
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

export function slugify(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(NON_ASCII_MARKS, "")
    .toLowerCase()
    .replace(NON_SLUG_CHARS, "-")
    .replace(EDGE_HYPHENS, "");

  return normalized.length > 0 ? normalized : "item";
}

export function makeUniqueSlug(baseSlug: string, existingSlugs: ReadonlySet<string>): string {
  if (!existingSlugs.has(baseSlug)) {
    return baseSlug;
  }

  let suffix = 2;
  while (existingSlugs.has(`${baseSlug}-${suffix}`)) {
    suffix += 1;
  }

  return `${baseSlug}-${suffix}`;
}
