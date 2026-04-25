import type { ReactNode } from "react";

import { GITHUB_LATEST_RELEASE_URL, GITHUB_REPO_URL } from "../lib/links";

/**
 * The main pitch — a centered headline + subhead + two download links —
 * sitting in a 1152px-wide container framed by hairline rules on every side
 * so the layout reads as one column of editorial cells. Matches the Paper
 * design (https://app.paper.design/file/01KQ1Z41FR6DQKXAPQ37VXG66J/2-0).
 */
export function Hero(): ReactNode {
  return (
    <section className="w-full border-b border-border">
      <div className="mx-auto flex max-w-[1152px] flex-col items-center gap-[42px] border-x border-border px-8 py-20">
        <div className="flex flex-col items-center gap-5">
          <h1 className="max-w-[616px] text-center text-[42px] font-medium leading-[120%] tracking-[-0.03em] text-foreground">
            Development observability stack for humans and agents
          </h1>
          <p className="max-w-[368px] text-center text-[14px] leading-[150%] tracking-[-0.03em] text-muted-foreground">
            You and your agent can now move beyond static code to see what actually happened at
            runtime.
          </p>
        </div>

        <div className="flex items-center justify-center gap-4">
          <a
            href={GITHUB_LATEST_RELEASE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center rounded-lg bg-[var(--primary)] px-3 py-2 text-[14px] leading-[150%] text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            Download for Mac
          </a>
          <a
            href={"/download"}
            className="text-[14px] leading-[150%] text-[var(--primary)] transition-colors hover:text-muted-foreground"
          >
            Other platforms
          </a>
        </div>
      </div>
    </section>
  );
}
