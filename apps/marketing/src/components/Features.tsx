import { Activity, Bot, Database, Flame, Layers, Radio, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SectionHeading } from "./AiAndHumans";

type Feature = {
  id: string;
  icon: LucideIcon;
  title: string;
  description: string;
};

const FEATURES: Array<Feature> = [
  {
    id: "01",
    icon: Radio,
    title: "Works with your stack",
    description:
      "No proprietary agents. No wrappers around your code. Drop in one env var and Lensflare catches your traces, logs, and metrics as they happen.",
  },
  {
    id: "02",
    icon: Database,
    title: "Local-first DuckDB storage",
    description:
      "Your telemetry stays on your machine. Query 100M spans in under a second with columnar storage built for analytics.",
  },
  {
    id: "03",
    icon: Layers,
    title: "Built on Effect",
    description:
      "A runtime designed for correctness. Every pipeline is typed, cancellable, and resilient — so Lensflare itself doesn't become the thing you're debugging.",
  },
  {
    id: "04",
    icon: Bot,
    title: "AI-readable insights",
    description:
      "Every trace, log, and metric has a structured, AI-consumable representation. Your coding agent can investigate, not just look.",
  },
  {
    id: "05",
    icon: Activity,
    title: "Desktop, web, and server",
    description:
      "Run it in Electron on your laptop. Self-host the server. Open the web UI from anywhere. Same data model everywhere.",
  },
  {
    id: "06",
    icon: Flame,
    title: "Debug-time focused",
    description:
      "Not dashboards you never look at. Lensflare is designed for the moment something's on fire — and the moment you need to ask why.",
  },
];

/**
 * Six-cell feature grid rendered as a single matrix of hard-bordered cells —
 * no gap, no gutter, no radius. Top-left number + icon, then copy.
 */
export function Features(): ReactNode {
  return (
    <section id="features" className="border-b border-foreground/15">
      <SectionHeading
        eyebrow="02 · Features"
        title="Everything you need to answer what just happened?"
        body="Lensflare is a sharp, opinionated set of tools for the moments you actually need observability — when the deploy just went out, when the agent is stuck, when someone says it's broken."
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 border-t border-foreground/15 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(({ id, icon: Icon, title, description }, index) => (
          <article
            key={title}
            data-reveal
            style={{ ["--reveal-delay" as string]: `${index * 40}ms` }}
            className={`${cellClass(index)} cell-hover group hover:bg-muted/60`}
          >
            <div className="flex items-center justify-between font-mono text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
              <span className="transition-colors group-hover:text-brand">{id}</span>
              <Icon
                className="h-4 w-4 text-foreground transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:text-brand"
                aria-hidden="true"
              />
            </div>
            <h3 className="mt-6 text-[1.05rem] font-semibold tracking-tight text-foreground sm:text-[1.1rem]">
              {title}
            </h3>
            <p className="mt-3 text-[0.92rem] leading-relaxed text-muted-foreground">
              {description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Compute which edges need a border so the grid renders as a matrix of cells
 *  without doubling lines. Every cell gets a top-border on mobile, then on
 *  `sm:` and `lg:` the borders collapse into a proper matrix. */
function cellClass(index: number): string {
  const base = "flex flex-col px-5 py-8 sm:px-8 sm:py-10";
  const borders = [
    index > 0 ? "border-t border-foreground/15" : "",
    // sm: two columns. odd-indexed cells get a left border; every row after
    // the first gets a top border. Use index math because Tailwind can't do
    // nth-child arithmetic directly.
    index % 2 === 1 ? "sm:border-l sm:border-foreground/15" : "",
    index >= 2 ? "sm:border-t sm:border-foreground/15" : "sm:border-t-0",
    // lg: three columns. Reset and recompute.
    index % 3 !== 0 ? "lg:border-l lg:border-foreground/15" : "lg:border-l-0",
    index >= 3 ? "lg:border-t lg:border-foreground/15" : "lg:border-t-0",
  ];
  return [base, ...borders].filter(Boolean).join(" ");
}
