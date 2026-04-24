import type { ReactNode } from "react";

/**
 * Thin full-width strip between hero and the split cards. Mono text, hard top
 * & bottom rules, column dividers between claims.
 */
const ITEMS: Array<{ kbd: string; label: string }> = [
  { kbd: "$0", label: "Free — forever" },
  { kbd: "MIT", label: "Open source" },
  { kbd: "OSS", label: "Built in the open" },
];

export function OpenSourceBanner(): ReactNode {
  return (
    <section className="border-b border-foreground/15 bg-background">
      <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-foreground/15 px-5 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-8">
        {ITEMS.map(({ kbd, label }, idx) => (
          <div
            key={label}
            data-reveal
            style={{ ["--reveal-delay" as string]: `${idx * 60}ms` }}
            className="flex items-center gap-4 px-0 py-5 sm:justify-center sm:px-6"
          >
            <span className="inline-flex h-7 min-w-[3rem] items-center justify-center border border-foreground/25 px-2 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-foreground">
              {kbd}
            </span>
            <span className="font-mono text-[0.78rem] uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
