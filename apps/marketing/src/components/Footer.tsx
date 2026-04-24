import type { ReactNode } from "react";

import { GITHUB_ISSUES_URL, GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_URL } from "../lib/links";
import { Logo } from "./Logo";

type Column = {
  heading: string;
  links: Array<{ label: string; href: string; external?: boolean }>;
};

const COLUMNS: Array<Column> = [
  {
    heading: "Product",
    links: [
      { label: "Features", href: "#features" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Platforms", href: "#platforms" },
      { label: "Download", href: GITHUB_LATEST_RELEASE_URL, external: true },
    ],
  },
  {
    heading: "Developers",
    links: [
      { label: "GitHub", href: GITHUB_REPO_URL, external: true },
      { label: "Releases", href: GITHUB_LATEST_RELEASE_URL, external: true },
      { label: "Report an issue", href: GITHUB_ISSUES_URL, external: true },
    ],
  },
  {
    heading: "Community",
    links: [
      { label: "OpenTelemetry", href: "https://opentelemetry.io", external: true },
      { label: "Effect", href: "https://effect.website", external: true },
      { label: "DuckDB", href: "https://duckdb.org", external: true },
    ],
  },
];

/**
 * Footer: hairline top rule, mono column headings, mono links. Bottom strip
 * is divided by a single rule from the link grid — no soft backgrounds.
 */
export function Footer(): ReactNode {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-background">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid gap-10 py-16 sm:grid-cols-2 md:grid-cols-[1.3fr_repeat(3,1fr)]">
          <div className="flex flex-col gap-6">
            <Logo className="h-5 w-auto text-foreground" />
            <p className="max-w-xs text-[0.88rem] leading-relaxed text-muted-foreground">
              Free, open-source observability built for the humans and the agents who debug together.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading} className="flex flex-col gap-4">
              <h3 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-foreground">
                {col.heading}
              </h3>
              <ul className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      {...(link.external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                      className="font-mono text-[0.82rem] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col items-start justify-between gap-4 border-t border-foreground/15 py-6 font-mono text-[0.72rem] uppercase tracking-[0.14em] text-muted-foreground sm:flex-row sm:items-center">
          <p>© {year} VoidHash · MIT licensed</p>
          <div className="flex items-center gap-6">
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <a
              href={GITHUB_ISSUES_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-colors hover:text-foreground"
            >
              Issues
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
