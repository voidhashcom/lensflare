import type { ReactNode } from "react";

import type { DownloadLink, LatestReleaseDownloads } from "../lib/releases";
import { AppleIcon } from "./icons/AppleIcon";

interface PlatformCardProps {
  title: string;
  description: string;
  download: DownloadLink;
  format: string;
  /**
   * Adds a hairline right border so two cards sitting side-by-side share a
   * divider that lines up with the rest of the page chrome. Set on every card
   * except the last one in a row.
   */
  withRightDivider?: boolean;
}

function PlatformCard({
  title,
  description,
  download,
  format,
  withRightDivider = false,
}: PlatformCardProps): ReactNode {
  return (
    <a
      href={download.href}
      target="_blank"
      rel="noreferrer noopener"
      className={`group flex grow basis-0 flex-col gap-6 bg-background p-6 transition-colors hover:bg-[#FAFAFA] ${
        withRightDivider ? "border-r border-border" : ""
      }`}
    >
      <div className="flex flex-col gap-1.5">
        <h3 className="text-[18px] font-medium leading-[24px] tracking-[-0.02em] text-foreground">
          {title}
        </h3>
        <p className="text-[13px] leading-[18px] text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center justify-between pt-2">
        <span className="text-[14px] font-medium leading-[20px] text-foreground">
          {download.available ? `Download ${format}` : "View release"}
        </span>
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[14px] leading-none text-[var(--primary-foreground)] transition-transform group-hover:translate-y-0.5"
        >
          ↓
        </span>
      </div>
    </a>
  );
}

/**
 * macOS download cards. URLs are resolved from the latest GitHub release assets
 * in Astro frontmatter, with GitHub's release page as a fallback when an
 * architecture-specific asset is not present.
 */
export function PlatformDownloads({ release }: { release: LatestReleaseDownloads }): ReactNode {
  return (
    <section className="w-full border-b border-border">
      <div className="mx-auto flex max-w-[1152px] flex-col border-x border-border">
        <div className="flex flex-col">
          <div className="flex items-center border-b border-border bg-[#FAFAFA] px-8 py-4">
            <div className="flex items-center gap-3.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center text-foreground">
                <AppleIcon className="h-[27px] w-[22px]" />
              </span>
              <h2 className="text-[16px] font-medium leading-[28px] tracking-[-0.02em] text-foreground">
                macOS
              </h2>
              <p className="text-[14px] leading-[28px] text-muted-foreground">
                11 Big Sur or later
              </p>
            </div>
          </div>
          <div className="flex">
            <PlatformCard
              title="Apple Silicon"
              description="For M1, M2, M3, M4 Macs · arm64"
              download={release.downloads.macArm64}
              format=".dmg"
              withRightDivider
            />
            <PlatformCard
              title="Intel"
              description="For older Intel-based Macs · x64"
              download={release.downloads.macX64}
              format=".dmg"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
