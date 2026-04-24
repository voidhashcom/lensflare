import type { ReactNode } from "react";

import { GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_URL } from "../lib/links";
import { SectionHeading } from "./AiAndHumans";

type Platform = {
  id: string;
  label: string;
  title: string;
  description: string;
  items: Array<string>;
  href: string;
  linkLabel: string;
  external?: boolean;
};

const PLATFORMS: Array<Platform> = [
  {
    id: "a",
    label: "Desktop",
    title: "Native Electron app.",
    description:
      "A native-feeling Electron app with auto-updates. Download one binary, open it, start debugging.",
    items: ["macOS — Apple Silicon & Intel", "Linux — AppImage", "Windows — NSIS installer"],
    href: GITHUB_LATEST_RELEASE_URL,
    linkLabel: "See the latest release",
    external: false,
  },
  {
    id: "b",
    label: "Server",
    title: "Self-hosted & web.",
    description:
      "Run the Lensflare server anywhere — laptop, cluster, staging host — and open the web UI from any browser.",
    items: ["Node.js server, single binary", "Same UI as the desktop app", "Stores data locally in DuckDB"],
    href: GITHUB_REPO_URL,
    linkLabel: "Read the README",
    external: true,
  },
];

export function Platforms(): ReactNode {
  return (
    <section id="platforms" className="border-b border-foreground/15">
      <SectionHeading
        eyebrow="05 · Platforms"
        title="Runs where you do."
        body="Use it as a local desktop client or a self-hosted server. Same storage layer, same query language, same UI."
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 border-t border-foreground/15 md:grid-cols-2">
        {PLATFORMS.map((p, idx) => (
          <div
            key={p.id}
            data-reveal
            style={{ ["--reveal-delay" as string]: `${idx * 60}ms` }}
            className={`cell-hover group flex flex-col gap-6 px-5 py-12 hover:bg-muted/60 sm:px-8 sm:py-16 ${
              idx > 0 ? "border-t border-foreground/15 md:border-t-0 md:border-l" : ""
            }`}
          >
            <div className="flex items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
              <span>{p.label}</span>
              <span>[{p.id}]</span>
            </div>

            <h3 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
              {p.title}
            </h3>

            <p className="max-w-prose text-[0.98rem] leading-relaxed text-muted-foreground">
              {p.description}
            </p>

            <ul className="flex flex-col divide-y divide-foreground/15 border-y border-foreground/15">
              {p.items.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3 py-3 font-mono text-[0.8rem] text-foreground"
                >
                  <span className="text-muted-foreground">▸</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <a
              href={p.href}
              target={p.external ? "_blank" : undefined}
              rel={p.external ? "noreferrer noopener" : undefined}
              className="mt-auto inline-flex w-fit items-center gap-2 border-b border-foreground pb-0.5 font-mono text-[0.78rem] uppercase tracking-[0.14em] text-foreground transition-colors hover:border-brand hover:text-brand"
            >
              <span>{p.linkLabel}</span>
              <span
                aria-hidden="true"
                className="transition-transform duration-200 group-hover:translate-x-0.5"
              >
                →
              </span>
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}
