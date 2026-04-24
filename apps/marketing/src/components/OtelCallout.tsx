import type { ReactNode } from "react";

import { OPENTELEMETRY_URL } from "../lib/links";
import { SectionHeading } from "./AiAndHumans";

const SIGNALS = ["Traces", "Logs", "Metrics"];
const LANGUAGES = [
  "JavaScript / TypeScript",
  "Go",
  "Python",
  "Rust",
  "Java",
  ".NET",
  "Ruby",
  "PHP",
];

/**
 * Renamed from "OpenTelemetry native" → plain "Compatibility". The OTel
 * mention is demoted to a single footnote — users who care about the
 * protocol will still find it, everyone else just sees "works with your
 * stack".
 */
export function OtelCallout(): ReactNode {
  return (
    <section className="border-b border-foreground/15 bg-muted/30">
      <SectionHeading
        eyebrow="04 · Compatibility"
        title="Works with the stack you already have."
        body="If your app already emits traces, logs, or metrics, Lensflare sees them. No proprietary agents. No wrappers around your code. No lock-in — drop in one env var and you're debugging."
      />

      <div className="mx-auto grid max-w-6xl grid-cols-1 border-t border-foreground/15 md:grid-cols-[1fr_1.2fr]">
        <div data-reveal className="flex flex-col gap-8 px-5 py-12 sm:px-8 sm:py-16">
          <div>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
              Signals it handles
            </p>
            <ul className="mt-4 flex flex-col divide-y divide-foreground/15 border-y border-foreground/15">
              {SIGNALS.map((signal) => (
                <li
                  key={signal}
                  className="flex items-center justify-between py-3 font-mono text-[0.82rem] text-foreground"
                >
                  <span className="uppercase tracking-[0.12em]">{signal}</span>
                  <span className="text-muted-foreground">✓ ready</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-[0.92rem] leading-relaxed text-muted-foreground">
            Built on the open OTLP standard — any SDK that speaks it works. Read the spec at{" "}
            <a
              href={OPENTELEMETRY_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
            >
              opentelemetry.io
            </a>
            .
          </p>
        </div>

        <div
          data-reveal
          style={{ ["--reveal-delay" as string]: "80ms" }}
          className="flex flex-col gap-6 border-t border-foreground/15 px-5 py-12 sm:px-8 sm:py-16 md:border-t-0 md:border-l"
        >
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
            Languages tested
          </p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0 border-t border-foreground/15">
            {LANGUAGES.map((lang, idx) => (
              <li
                key={lang}
                className={`flex items-center gap-3 py-3 font-mono text-[0.82rem] text-foreground ${
                  idx % 2 === 1 ? "border-l border-foreground/15 pl-4" : ""
                } ${idx >= 2 ? "border-t border-foreground/15" : ""}`}
              >
                <span className="text-muted-foreground">→</span>
                <span>{lang}</span>
              </li>
            ))}
          </ul>
          <p className="text-[0.92rem] leading-relaxed text-muted-foreground">
            Any language with a standard exporter works — these are the SDKs Lensflare is tested against
            on every release.
          </p>
        </div>
      </div>
    </section>
  );
}
