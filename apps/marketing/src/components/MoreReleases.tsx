import type { ReactNode } from "react";

import { GITHUB_REPO_URL, GITHUB_RELEASES_URL } from "../lib/links";

/**
 * Closing cell — points users at the GitHub releases page for older versions
 * and signed checksums. Sits inside the same hairline frame as the rest of
 * the page, with content left-aligned and vertically centered so the cell
 * reads as a quiet aside rather than a primary CTA.
 *
 * The display label is derived from `GITHUB_REPO_URL` so it stays in sync if
 * the repo is ever renamed — single source of truth in `lib/links.ts`.
 */
export function MoreReleases(): ReactNode {
  const repoLabel = GITHUB_REPO_URL.replace(/^https?:\/\//, "");

  return (
    <section className="w-full border-b border-border">
      <div className="mx-auto flex max-w-[1152px] border-x border-border">
        <div className="flex grow basis-0 flex-col items-start justify-center gap-3 px-10 py-12">
          <p className="max-w-[360px] text-[14px] leading-[22px] text-[#6B6B6B]">
            Looking for older versions? Every release with full changelogs and
            signed checksums lives on GitHub.
          </p>
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 pt-1.5 text-foreground transition-opacity hover:opacity-70"
          >
            <span className="text-[14px] font-medium leading-[20px]">
              {repoLabel}
            </span>
            <span aria-hidden="true" className="text-[14px] leading-[20px]">
              ↗
            </span>
          </a>
        </div>
      </div>
    </section>
  );
}
