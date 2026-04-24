import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "../../lib/utils";

/**
 * Sharp-bordered container. No shadow, no radius, minimal chrome — the card
 * boundary is conveyed by a single 1px rule, nothing more.
 */
export function Card({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"div">): ReactNode {
  return (
    <div
      className={cn(
        "relative border border-foreground/15 bg-card text-card-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">): ReactNode {
  return <div className={cn("flex flex-col gap-2 p-6", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"h3">): ReactNode {
  return <h3 className={cn("text-lg font-semibold tracking-tight", className)} {...props} />;
}

export function CardDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<"p">): ReactNode {
  return (
    <p
      className={cn("text-[0.95rem] leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">): ReactNode {
  return <div className={cn("px-6 pb-6", className)} {...props} />;
}
