import type { Integration, TemplateVars } from "~/integrations/types";
import { cn } from "~/lib/utils";

import { CodeBlock } from "../../CodeBlock/CodeBlock";

interface IntegrationStepsProps {
  integration: Integration;
  variables: TemplateVars;
  className?: string;
}

/**
 * Render the numbered walkthrough for a single integration as a flat
 * documentation list. Each step is a hairline-separated block — no card
 * chrome — so the guide reads like the rest of the settings-style pages
 * instead of a stack of widgets. Steps without a snippet still get the
 * step number so the count stays in sync with the author's intent.
 */
export function IntegrationSteps({ integration, variables, className }: IntegrationStepsProps) {
  return (
    <ol className={cn("flex flex-col", className)}>
      {integration.steps.map((step, index) => (
        <li
          className="flex flex-col gap-3 border-border/60 border-t pt-6 pb-2 first:border-t-0 first:pt-0"
          key={`${integration.id}-step-${index}`}
        >
          <div className="flex items-baseline gap-2.5">
            <span
              aria-hidden="true"
              className="font-mono font-semibold text-[11px] text-muted-foreground/70 tabular-nums tracking-[0.08em]"
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="font-semibold text-base text-foreground tracking-[-0.01em]">
              {step.title}
            </h3>
          </div>
          {step.body ? (
            <p className="whitespace-pre-line text-[13px] text-muted-foreground/80 leading-relaxed">
              {step.body}
            </p>
          ) : null}
          {step.snippet ? <CodeBlock snippet={step.snippet} variables={variables} /> : null}
          {step.note ? (
            <p className="text-muted-foreground/70 text-xs leading-relaxed">{step.note}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
