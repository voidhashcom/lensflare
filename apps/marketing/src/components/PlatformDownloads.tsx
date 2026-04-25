import type { ReactNode } from "react";

import { GITHUB_LATEST_RELEASE_URL } from "../lib/links";
import { AppleIcon } from "./icons/AppleIcon";

interface PlatformCardProps {
  title: string;
  description: string;
  href: string;
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
  href,
  withRightDivider = false,
}: PlatformCardProps): ReactNode {
  return (
    <a
      href={href}
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
        <p className="text-[13px] leading-[18px] text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="flex items-center justify-between pt-2">
        <span className="text-[14px] font-medium leading-[20px] text-foreground">
          Download .dmg
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
 * macOS download cards — section header sitting on a tinted #FAFAFA strip
 * (matching the version pill above), then two cards split by a hairline:
 * Apple Silicon on the left, Intel on the right. Matches the Paper design 1:1.
 *
 * Structured so adding Windows or Linux later is just another sibling block
 * inside the same `gap-16` flex column — the existing macOS markup wouldn't
 * need to change.
 */
export function PlatformDownloads(): ReactNode {
  return (
    <section className="w-full border-b border-border">
      <div className="mx-auto flex max-w-[1152px] flex-col gap-16 border-x border-border">
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
              href={GITHUB_LATEST_RELEASE_URL}
              withRightDivider
            />
            <PlatformCard
              title="Intel"
              description="For older Intel-based Macs · x64"
              href={GITHUB_LATEST_RELEASE_URL}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
