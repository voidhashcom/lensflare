import { Undo2Icon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * A visually grouped block of related settings. Renders a prominent section
 * heading followed by a flat list of {@link SettingsRow} entries separated by
 * hairline horizontal dividers.
 */
export function SettingsSection({
  title,
  icon,
  headerAction,
  children,
}: {
  title: string;
  icon?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1">
      <div className="flex min-h-8 items-center justify-between gap-3 pb-3">
        <h2 className="flex items-center gap-2 font-semibold text-foreground text-xl tracking-tight">
          {icon}
          {title}
        </h2>
        {headerAction}
      </div>
      <div>{children}</div>
    </section>
  );
}

/**
 * A single row inside a {@link SettingsSection}. The row lays out a title +
 * description block on the left and an optional control on the right,
 * switching to a stacked layout on small screens. Rows within a section are
 * separated by a hairline divider, with the first row having no top border.
 */
export function SettingsRow({
  title,
  description,
  status,
  resetAction,
  control,
  children,
}: {
  title: ReactNode;
  description: string;
  status?: ReactNode;
  resetAction?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-border/60 border-t first:border-t-0",
        children ? "pt-4 pb-0" : "py-4",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="font-semibold text-foreground text-sm tracking-[-0.01em]">
              {title}
            </h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          <p className="text-[13px] text-muted-foreground/80 leading-relaxed">{description}</p>
          {status ? <div className="pt-0.5 text-[11px] text-muted-foreground">{status}</div> : null}
        </div>
        {control ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            {control}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Small ghost button shown next to a setting title when the current value
 * differs from its default. Clicking invokes `onClick` which is expected to
 * restore the default.
 */
export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      aria-label={`Reset ${label} to default`}
      className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      size="icon-xs"
      title="Reset to default"
      variant="ghost"
    >
      <Undo2Icon className="size-3" />
    </Button>
  );
}

/**
 * Scroll container for a settings page. Constrains the content width so rows
 * stay readable on wide displays while leaving the header free to span the
 * whole inset.
 */
export function SettingsPageContainer({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">{children}</div>
    </div>
  );
}
