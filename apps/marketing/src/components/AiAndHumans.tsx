import type { ReactNode } from "react";

/**
 * Humans + agents split. Two hard-bordered columns, monospace labels at top,
 * plain prose below, mono check-marks on the feature list. Sharp edges only.
 */
const YOU = [
  "Waterfall trace explorer with span-level drill-downs",
  "Live log tail with saved filter presets",
  "Local-first — your data never leaves your machine",
];

const AGENT = [
  "Structured trace, log, and metric queries",
  "Deterministic, typed responses your agent can parse",
  "Plug into any MCP-capable coding assistant",
];

export function AiAndHumans(): ReactNode {
  return (
    <section className="border-b border-foreground/15">
      <SectionHeading
        eyebrow="01 · Audience"
        title="Built for the humans and the agents on your team."
        body="Observability shouldn't stop at a dashboard. Lensflare's data model is designed to be read by people in the moment — and by the coding agents that work alongside them."
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 border-t border-foreground/15 md:grid-cols-2">
        <Column label="For you" index="[you]" items={YOU}>
          Open the desktop app, scrub through a trace, and hit play on a failing request. Rich filters,
          live tails, and a query language that feels like your editor — not a dashboard you need a
          tutorial for.
        </Column>
        <Column
          label="For your AI agent"
          index="[agent]"
          items={AGENT}
          delay={80}
          className="border-t border-foreground/15 md:border-t-0 md:border-l"
        >
          Expose your running app's state to your coding agent. It can ask <em>what broke at 14:32?</em>
          {" "}and get the exact span tree — structured, typed, and ready to reason about. Not a screenshot.
          Not a vibes-check.
        </Column>
      </div>
    </section>
  );
}

function Column({
  label,
  index,
  items,
  children,
  className = "",
  delay = 0,
}: {
  label: string;
  index: string;
  items: Array<string>;
  children: ReactNode;
  className?: string;
  delay?: number;
}): ReactNode {
  return (
    <div
      data-reveal
      style={{ ["--reveal-delay" as string]: `${delay}ms` }}
      className={`flex flex-col gap-6 px-5 py-12 sm:px-8 sm:py-16 ${className}`}
    >
      <div className="flex items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
        <span>{label}</span>
        <span>{index}</span>
      </div>

      <h3 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-3xl">
        {label}.
      </h3>

      <p className="max-w-prose text-[0.98rem] leading-relaxed text-muted-foreground">{children}</p>

      <ul className="mt-auto flex flex-col divide-y divide-foreground/15 border-t border-foreground/15">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-start gap-3 py-3 font-mono text-[0.78rem] leading-relaxed text-foreground"
          >
            <span className="mt-[0.1rem] shrink-0 text-muted-foreground">→</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stark section heading re-used by several sections. Left-aligned eyebrow,
 *  tight headline, long prose. Rendered inside the section's top margin. */
export function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}): ReactNode {
  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-16 sm:grid-cols-[0.8fr_1fr] sm:px-8 sm:py-20">
      <div
        data-reveal
        className="font-mono text-[0.72rem] uppercase tracking-[0.18em] text-muted-foreground"
      >
        {eyebrow}
      </div>
      <div
        data-reveal
        style={{ ["--reveal-delay" as string]: "80ms" }}
        className="flex flex-col gap-4"
      >
        <h2 className="text-balance text-3xl font-bold leading-[1.08] tracking-[-0.02em] text-foreground sm:text-4xl">
          {title}
        </h2>
        {body ? (
          <p className="max-w-prose text-[1rem] leading-relaxed text-muted-foreground">{body}</p>
        ) : null}
      </div>
    </div>
  );
}
