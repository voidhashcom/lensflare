import type { Integration, TemplateVars } from "~/integrations/types";
import { cn } from "~/lib/utils";

import { CodeBlock } from "../../CodeBlock/CodeBlock";
import { Card, CardHeader, CardPanel, CardTitle } from "../../ui/card";

interface IntegrationStepsProps {
  integration: Integration;
  variables: TemplateVars;
  className?: string;
}

/**
 * Render the numbered walkthrough for a single integration. Each step is
 * its own `Card` so the list stays visually chunked even when the body or
 * snippet is short. Steps without a snippet (e.g. pure prose prerequisites)
 * still get the number badge so the count stays in sync with the author's
 * intent.
 */
export function IntegrationSteps({
  integration,
  variables,
  className,
}: IntegrationStepsProps) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {integration.steps.map((step, index) => (
        <Card className="rounded-xl" key={`${integration.id}-step-${index}`}>
          <CardHeader className="flex-row items-start gap-3 pb-2">
            <div
              aria-hidden="true"
              className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border/80 bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums"
            >
              {index + 1}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="text-sm leading-snug">
                {step.title}
              </CardTitle>
              {step.body ? (
                <p className="whitespace-pre-line text-sm text-muted-foreground">
                  {step.body}
                </p>
              ) : null}
            </div>
          </CardHeader>
          {step.snippet || step.note ? (
            <CardPanel className="flex flex-col gap-2 pt-0">
              {step.snippet ? (
                <CodeBlock snippet={step.snippet} variables={variables} />
              ) : null}
              {step.note ? (
                <p className="text-xs text-muted-foreground/80">{step.note}</p>
              ) : null}
            </CardPanel>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
