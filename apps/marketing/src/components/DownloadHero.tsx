import type { ReactNode } from "react";

import type { LatestReleaseDownloads } from "../lib/releases";

/**
 * Download page title block + status pill. The pill pairs a green "Latest"
 * indicator with a compact "View changelog" sub-pill that links out to the
 * full releases page on GitHub. Matches the Paper design 1:1
 * (https://app.paper.design/file/01KQ1Z41FR6DQKXAPQ37VXG66J/2-0/2L-0).
 *
 * The hero is left-aligned (unlike the home Hero) because the platform cards
 * below also stack from the left edge — the reading lane stays consistent all
 * the way down.
 */
export function DownloadHero({ release }: { release: LatestReleaseDownloads }): ReactNode {
  const releaseLabel = release.available
    ? `Latest · ${release.versionLabel}`
    : release.versionLabel;

  return (
    <section className="w-full border-b border-border">
      <div className="mx-auto flex max-w-[1152px] flex-col items-start gap-8 border-x border-border px-8 pt-24 pb-20">
        <div className="flex flex-col items-start gap-4">
          <h1 className="max-w-[720px] text-[36px] font-medium leading-[120%] tracking-[-0.035em] text-foreground">
            Download Lensflare
          </h1>
          <p className="max-w-[520px] text-[14px] leading-[150%] text-[#6B6B6B]">
            A development observability stack for humans and agents. Free, open source, and built
            for macOS on Apple Silicon and Intel Macs.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-full border border-border bg-[#FAFAFA] py-1.5 pr-1.5 pl-3.5">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2DB47A]" />
          <span className="text-[13px] font-medium leading-[16px] text-foreground">
            {releaseLabel}
          </span>
          <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-[#E0E0E0]" />
          <a
            href={release.releaseUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[12px] leading-[16px] text-[#6B6B6B] transition-colors hover:text-foreground"
          >
            <span>View changelog</span>
            <span aria-hidden="true" className="text-muted-foreground">
              ↗
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
