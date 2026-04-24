import { useMemo, useState } from "react";
import { BookOpenIcon } from "lucide-react";

import { integrationRegistry } from "~/integrations/registry";
import type { Language, TemplateVars } from "~/integrations/types";
import { cn } from "~/lib/utils";

import { Badge } from "../../ui/badge";
import { IntegrationPicker } from "./IntegrationPicker";
import { IntegrationSteps } from "./IntegrationSteps";

interface EmptyDatasetGuideProps {
  datasetName: string;
  projectSlug: string;
  datasetSlug: string;
  serverOrigin: string;
  /**
   * When the guide is rendered as an overlay on the live tab we want
   * extra negative space at the top so it doesn't look cramped against
   * the filter bar. Sheets don't need that — their own padding applies.
   */
  variant?: "overlay" | "sheet";
  className?: string;
}

const PROTOCOL_LABEL: Record<string, string> = {
  "otlp-http": "OTLP HTTP",
  "axiom-native": "Axiom-native",
  curl: "Raw HTTP",
};

/**
 * The "getting started" screen shown when a dataset has no telemetry yet.
 * Renders the full language + library picker and walks the user through
 * a specific integration's steps, with slugs substituted live into every
 * snippet.
 *
 * Same component is used both as the in-place overlay on `LiveTabPanel`
 * (when the dataset has never received a log) and inside the
 * `LogStreamHeader` sheet (re-entry button for users who have data
 * flowing but want the snippets back).
 */
export function EmptyDatasetGuide({
  datasetName,
  projectSlug,
  datasetSlug,
  serverOrigin,
  variant = "overlay",
  className,
}: EmptyDatasetGuideProps) {
  const defaultIntegration = integrationRegistry.getDefault();
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(
    defaultIntegration?.language ?? "node",
  );
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>(
    defaultIntegration?.library.id ?? "opentelemetry-sdk",
  );

  const integration = useMemo(() => {
    const exact = integrationRegistry.find({
      language: selectedLanguage,
      libraryId: selectedLibraryId,
    });
    if (exact) return exact;
    // The previously picked library does not exist for this language —
    // pick the first available one for the language so the user is never
    // looking at a blank steps list.
    return integrationRegistry.listIntegrations(selectedLanguage)[0];
  }, [selectedLanguage, selectedLibraryId]);

  const variables = useMemo<TemplateVars>(
    () => ({
      projectSlug,
      datasetSlug,
      serverOrigin,
      // Axiom-native bearer token convention: the bearer _is_ the project
      // slug. Kept as its own variable so snippets can read as ordinary
      // auth flows rather than hardcoding the quirk.
      bearerToken: projectSlug,
    }),
    [datasetSlug, projectSlug, serverOrigin],
  );

  const handleLanguageChange = (language: Language) => {
    setSelectedLanguage(language);
    const firstLibrary =
      integrationRegistry.listLibraries(language)[0]?.id ?? "";
    setSelectedLibraryId(firstLibrary);
  };

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col",
        variant === "overlay" && "bg-background/95 backdrop-blur-sm",
        className,
      )}
      data-slot="empty-dataset-guide"
      data-variant={variant}
    >
      <Hero datasetName={datasetName} />

      <IntegrationPicker
        onLanguageChange={handleLanguageChange}
        onLibraryChange={setSelectedLibraryId}
        selectedLanguage={selectedLanguage}
        selectedLibraryId={selectedLibraryId}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-1 pb-8">
          {integration ? (
            <>
              <IntegrationSummary
                protocolLabel={
                  PROTOCOL_LABEL[integration.protocol] ?? integration.protocol
                }
                signals={integration.signals}
                summary={integration.summary}
              />
              <IntegrationSteps
                integration={integration}
                variables={variables}
              />
              {integration.verifyHint ? (
                <p className="rounded-lg border border-dashed border-border/60 bg-muted/30 p-3 text-xs text-muted-foreground">
                  {integration.verifyHint}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No integration guides are registered yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface HeroProps {
  datasetName: string;
}

function Hero({ datasetName }: HeroProps) {
  return (
    <div className="flex items-start gap-3 px-6 pt-6 pb-4">
      <div className="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
        <BookOpenIcon className="size-4" />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="relative inline-flex size-2 items-center justify-center"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-block size-2 rounded-full bg-primary" />
          </span>
          <h2 className="font-semibold text-base leading-none">
            Waiting for first event in{" "}
            <span className="text-primary">{datasetName}</span>
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Pick a language and a library below, then run one of the snippets
          to start sending data. This screen will disappear as soon as your
          first event lands.
        </p>
      </div>
    </div>
  );
}

interface IntegrationSummaryProps {
  protocolLabel: string;
  signals: ReadonlyArray<string>;
  summary: string;
}

function IntegrationSummary({
  protocolLabel,
  signals,
  summary,
}: IntegrationSummaryProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{protocolLabel}</Badge>
        {signals.map((signal) => (
          <Badge key={signal} variant="secondary">
            {signal}
          </Badge>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{summary}</p>
    </div>
  );
}
