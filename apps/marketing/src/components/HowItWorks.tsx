import type { ReactNode } from "react";

import { SectionHeading } from "./AiAndHumans";

type Step = {
  id: string;
  title: string;
  description: string;
  code?: string;
};

const STEPS: Array<Step> = [
  {
    id: "01",
    title: "Point your app at Lensflare.",
    description:
      "One env var, any language. If your app already emits traces, logs, or metrics, Lensflare catches them over gRPC or HTTP.",
    code: "OTEL_EXPORTER_OTLP_ENDPOINT=\nhttp://localhost:43110",
  },
  {
    id: "02",
    title: "Reproduce the issue.",
    description:
      "Telemetry streams into the desktop app in real time. Filter by request id, error, span attribute — whatever narrows it down.",
    code: "filter: status.code = error\n     + duration > 100ms",
  },
  {
    id: "03",
    title: "Ask — or let your agent ask.",
    description:
      "Query in the UI with a syntax that feels like your editor. Or plug Lensflare into your coding agent and let it investigate.",
    code: "> why did POST /checkout\n  fail at 14:32:04?",
  },
];

/**
 * Three numbered columns. Each cell has: mono index ➝ title ➝ prose ➝ mono
 * code block. No radius, no background variance, only hard rules between
 * cells.
 */
export function HowItWorks(): ReactNode {
  return (
    <section id="how-it-works" className="border-b border-foreground/15">
      <SectionHeading
        eyebrow="03 · How it works"
        title="Three steps from pnpm run dev to oh, that's what happened."
        body="There's no proprietary agent to install and no schema to design. Lensflare accepts your app's telemetry out of the box, stores it locally, and gets out of your way."
      />

      <ol className="mx-auto grid max-w-6xl grid-cols-1 border-t border-foreground/15 md:grid-cols-3">
        {STEPS.map((step, idx) => (
          <li
            key={step.id}
            data-reveal
            style={{ ["--reveal-delay" as string]: `${idx * 80}ms` }}
            className={`flex flex-col gap-6 px-5 py-12 sm:px-8 sm:py-16 ${
              idx > 0 ? "border-t border-foreground/15 md:border-t-0 md:border-l" : ""
            }`}
          >
            <div className="flex items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
              <span>{step.id}</span>
              <span>step</span>
            </div>

            <h3 className="text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">
              {step.title}
            </h3>

            <p className="text-[0.96rem] leading-relaxed text-muted-foreground">{step.description}</p>

            {step.code ? (
              <pre className="mt-auto overflow-x-auto border border-foreground/20 bg-muted/40 px-3 py-3 font-mono text-[0.78rem] leading-relaxed text-foreground">
                <code>{step.code}</code>
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
