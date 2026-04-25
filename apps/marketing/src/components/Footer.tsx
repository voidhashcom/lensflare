import type { ReactNode } from "react";

/**
 * Footer cell — same hairline frame as the rest of the page, just the
 * company line in muted gray on a single row. Matches the Paper design.
 */
export function Footer(): ReactNode {
  return (
    <footer className="w-full border-b border-border">
      <div className="mx-auto flex max-w-[1152px] flex-col gap-[42px] border-x border-border px-8 py-4">
        <p className="text-[14px] leading-[150%] tracking-[-0.03em] text-muted-foreground">
          Voidhash s.r.o.
        </p>
      </div>
    </footer>
  );
}
