import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_URL } from "../lib/links";
import { GithubIcon } from "./icons/GithubIcon";
import { Button } from "./ui/Button";

/**
 * Final CTA — hard-bordered slab, no gradient, no center text alignment.
 * Eyebrow on the left, large stark headline, CTAs right-aligned on desktop.
 */
export function FinalCta(): ReactNode {
  return (
    <section id="install" className="border-b border-foreground/15 bg-muted/30">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-20 sm:px-8 sm:py-28">
        <div
          data-reveal
          className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground"
        >
          Install · Free · MIT-licensed · No account
        </div>

        <h2
          data-reveal
          style={{ ["--reveal-delay" as string]: "60ms" }}
          className="max-w-4xl text-balance text-4xl font-bold leading-[1.02] tracking-[-0.02em] text-foreground sm:text-[3rem] md:text-[3.5rem]"
        >
          Stop paging through log files.
          <br />
          <span className="text-brand">Start debugging.</span>
        </h2>

        <div
          data-reveal
          style={{ ["--reveal-delay" as string]: "120ms" }}
          className="flex flex-col items-start gap-4 border-t border-foreground/15 pt-10 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="max-w-md text-[0.98rem] leading-relaxed text-muted-foreground">
            Free forever. MIT-licensed. No account required. No telemetry leaves your machine unless
            you send it.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
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
        </div>
      </div>
    </section>
  );
}
