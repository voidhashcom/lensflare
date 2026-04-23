import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "~/lib/utils";

export function TopTabsList({
  className,
  role = "tablist",
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("flex shrink-0 min-w-0 items-center border-b border-border/60", className)}
      role={role}
      {...props}
    />
  );
}

interface TopTabsItemProps extends ComponentPropsWithoutRef<"div"> {
  active: boolean;
}

export function TopTabsItem({ active, className, ...props }: TopTabsItemProps) {
  return (
    <div
      className={cn(
        "group -mb-px inline-flex min-w-0 items-stretch border-b-2",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
        className,
      )}
      role="presentation"
      {...props}
    />
  );
}

interface TopTabsTriggerProps extends Omit<ComponentPropsWithoutRef<"button">, "children"> {
  active: boolean;
  badge?: ReactNode;
  children: ReactNode;
  leading?: ReactNode;
  size?: "compact";
}

export function TopTabsTrigger({
  active,
  badge,
  children,
  className,
  leading,
  size = "compact",
  type = "button",
  ...props
}: TopTabsTriggerProps) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "inline-flex min-w-0 cursor-pointer items-center gap-1.5 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
        "px-3 py-2.5 text-xs",
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      role="tab"
      type={type}
      {...props}
    >
      {leading}
      <span className="min-w-0 truncate">{children}</span>
      {badge !== undefined ? (
        <span
          className={cn(
            "rounded px-1 font-mono text-[10px] tabular-nums",
            active ? "text-foreground/80" : "text-muted-foreground/60",
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
