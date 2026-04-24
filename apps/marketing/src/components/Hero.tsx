import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_URL } from "../lib/links";
import { GithubIcon } from "./icons/GithubIcon";
import { Button } from "./ui/Button";

/**
 * Centered hero in the style of firecrawl.dev: a small pill above, a big
 * two-tone headline (second line painted in the brand flame), a tight
 * subhead with an inline chip, one primary download CTA + a secondary GitHub
 * link, then a browser-chrome mock of the Lensflare desktop trace view
 * directly underneath. The section wraps itself in `.hero-grid` so the
 * blueprint grid + cursor-follow glow only apply here.
 */
export function Hero(): ReactNode {
  return (
    <section className="hero-grid relative overflow-hidden border-b border-foreground/15">
      {/* Bracketed framing marks in the corners — technical-drawing accent. */}
      <CornerMark className="left-5 top-6 sm:left-8">[ 200 OK ]</CornerMark>
      <CornerMark className="right-5 top-6 sm:right-8">[ TRACE ]</CornerMark>
      <CornerMark className="bottom-6 left-5 sm:left-8">[ .JSON ]</CornerMark>
      <CornerMark className="bottom-6 right-5 sm:right-8">[ .SPAN ]</CornerMark>

      <div className="relative mx-auto flex max-w-6xl flex-col items-center px-5 pt-20 pb-16 text-center sm:px-8 sm:pt-28 sm:pb-24">
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer noopener"
          data-reveal
          className="group inline-flex items-center gap-2 border border-foreground/25 bg-background px-3 py-1 font-mono text-[0.7rem] uppercase tracking-[0.16em] text-foreground transition-colors hover:border-foreground"
        >
          <span className="pulse-dot inline-block h-1.5 w-1.5 bg-brand" aria-hidden="true" />
          <span>v0.1 · Now in early access</span>
          <span
            aria-hidden="true"
            className="transition-transform duration-150 group-hover:translate-x-0.5"
          >
            →
          </span>
        </a>

        <h1
          data-reveal
          style={{ ["--reveal-delay" as string]: "60ms" }}
          className="mt-8 max-w-4xl text-balance text-[2.5rem] font-bold leading-[1.02] tracking-[-0.025em] text-foreground sm:text-[3.5rem] md:text-[4.25rem]"
        >
          Know exactly what happened
          <br />
          <span className="text-brand">in your code.</span>
        </h1>

        <p
          data-reveal
          style={{ ["--reveal-delay" as string]: "120ms" }}
          className="mt-6 max-w-2xl text-balance text-[1.02rem] leading-relaxed text-muted-foreground sm:text-[1.1rem]"
        >
          Lensflare turns your running app's traces, logs, and metrics into straight answers. For you
          when something fails. For your coding agent when it needs to know what actually broke.{" "}
          <span className="inline-flex items-center whitespace-nowrap border border-foreground/20 bg-muted px-1.5 py-0.5 text-foreground">
            It's free &amp; open source.
          </span>
        </p>

        <div
          data-reveal
          style={{ ["--reveal-delay" as string]: "180ms" }}
          className="mt-10 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Button href={GITHUB_LATEST_RELEASE_URL} size="lg" variant="brand">
            Download for Mac
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            href={GITHUB_REPO_URL}
            variant="outline"
            size="lg"
            target="_blank"
            rel="noreferrer noopener"
          >
            <GithubIcon className="h-4 w-4" />
            Star on GitHub
          </Button>
        </div>

        <p
          data-reveal
          style={{ ["--reveal-delay" as string]: "240ms" }}
          className="mt-5 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground"
        >
          macOS · Linux · Windows · MIT licensed
        </p>

        {/* App "screenshot" — a browser-chrome mock of the trace explorer. */}
        <div
          data-reveal
          style={{ ["--reveal-delay" as string]: "300ms" }}
          className="mt-16 w-full"
        >
          <AppScreenshot />
        </div>
      </div>
    </section>
  );
}

function CornerMark({ children, className }: { children: ReactNode; className: string }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute hidden font-mono text-[0.66rem] uppercase tracking-[0.2em] text-muted-foreground md:inline ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Browser-chrome mock of the Lensflare trace view. Not a real screenshot, but
 * built from the actual visual language of the product so it reads as a
 * preview rather than generic marketing art.
 */
function AppScreenshot(): ReactNode {
  return (
    <div className="relative mx-auto w-full max-w-5xl border border-foreground/20 bg-background">
      {/* Window chrome */}
      <div className="flex items-center gap-3 border-b border-foreground/15 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 border border-foreground/25" aria-hidden="true" />
          <span className="h-2.5 w-2.5 border border-foreground/25" aria-hidden="true" />
          <span className="h-2.5 w-2.5 border border-foreground/25" aria-hidden="true" />
        </div>
        <div className="ml-4 flex-1 border border-foreground/15 bg-muted px-2.5 py-1 text-left font-mono text-[0.7rem] text-muted-foreground">
          lensflare://trace/7d3f…e1c2
        </div>
        <div className="hidden items-center gap-2 font-mono text-[0.66rem] uppercase tracking-[0.16em] text-muted-foreground sm:flex">
          <span className="pulse-dot inline-block h-1.5 w-1.5 bg-brand" aria-hidden="true" />
          <span>Live</span>
        </div>
      </div>

      {/* Body — left sidebar, main trace waterfall */}
      <div className="grid grid-cols-1 md:grid-cols-[11rem_1fr]">
        {/* Sidebar */}
        <aside className="hidden flex-col gap-0 border-r border-foreground/15 md:flex">
          <SidebarItem label="Traces" active count="1.2M" />
          <SidebarItem label="Logs" count="8.4M" />
          <SidebarItem label="Metrics" count="214" />
          <SidebarItem label="Alerts" count="3" tone="brand" />
          <SidebarItem label="Agents" count="2" />
        </aside>

        {/* Main */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-2.5 font-mono text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="text-foreground">POST /api/checkout</span>
              <span>duration 412ms</span>
              <span className="text-brand">1 error</span>
            </div>
            <span>14:32:04 · span-tree</span>
          </div>

          <div className="flex flex-col gap-1.5 px-4 py-5 font-mono text-[0.76rem]">
            <TraceSpan name="POST /api/checkout" service="edge" offset={0} width={92} status="error" duration="412ms" />
            <TraceSpan name="├─ auth.verify" service="auth" offset={2} width={8} status="ok" duration="18ms" />
            <TraceSpan name="├─ db.query orders" service="pg" offset={10} width={54} status="ok" duration="287ms" />
            <TraceSpan name="│   ├─ SELECT * FROM orders" service="pg" offset={12} width={22} status="ok" duration="96ms" />
            <TraceSpan name="│   └─ SELECT * FROM line_items" service="pg" offset={34} width={30} status="ok" duration="184ms" />
            <TraceSpan name="├─ stripe.charge" service="stripe" offset={64} width={24} status="error" duration="118ms" />
            <TraceSpan name="└─ queue.publish" service="nats" offset={88} width={4} status="ok" duration="7ms" />
          </div>

          <div className="border-t border-foreground/15 px-4 py-3 font-mono text-[0.74rem] leading-relaxed text-foreground">
            <span className="text-muted-foreground">agent &gt;</span> why did <span className="text-brand">stripe.charge</span> fail at 14:32:04?<span className="caret" aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({
  label,
  count,
  active,
  tone,
}: {
  label: string;
  count: string;
  active?: boolean;
  tone?: "brand";
}): ReactNode {
  return (
    <div
      className={`flex items-center justify-between border-b border-foreground/15 px-4 py-2.5 font-mono text-[0.74rem] ${
        active ? "bg-muted text-foreground" : "text-muted-foreground"
      }`}
    >
      <span className="uppercase tracking-[0.12em]">{label}</span>
      <span className={tone === "brand" ? "text-brand tabular-nums" : "tabular-nums"}>{count}</span>
    </div>
  );
}

function TraceSpan({
  name,
  service,
  offset,
  width,
  status,
  duration,
}: {
  name: string;
  service: string;
  offset: number;
  width: number;
  status: "ok" | "error";
  duration: string;
}): ReactNode {
  return (
    <div className="grid grid-cols-[minmax(12rem,18rem)_1fr_auto] items-center gap-3">
      <span className="flex items-center gap-2 truncate">
        <span className="text-foreground">{name}</span>
        <span className="text-muted-foreground">· {service}</span>
      </span>
      <div className="relative h-3 border border-foreground/20">
        <div
          className={`h-full ${status === "error" ? "bg-brand" : "bg-foreground"}`}
          style={{ marginLeft: `${offset}%`, width: `${width}%` }}
        />
      </div>
      <span className="tabular-nums text-muted-foreground">{duration}</span>
    </div>
  );
}
