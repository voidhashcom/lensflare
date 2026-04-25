import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { integrationToMarkdown } from "~/integrations/markdown";
import { integrationRegistry, PROTOCOL_LABEL } from "~/integrations/registry";
import type { Integration, Language, TemplateVars } from "~/integrations/types";
import { cn } from "~/lib/utils";

import { IntegrationPicker } from "./IntegrationPicker";
import { IntegrationSteps } from "./IntegrationSteps";

interface EmptyDatasetGuideProps {
  projectSlug: string;
  datasetSlug: string;
  serverOrigin: string;
  /**
   * When the guide is rendered as an overlay on a telemetry tab we still
   * want the page-style padding to apply, but the overlay variant also
   * frosts the background so the underlying empty table hints through.
   * The `sheet` variant lets the parent `Sheet` own its own background.
   */
  variant?: "overlay" | "sheet";
  className?: string;
}

const COPY_FEEDBACK_MS = 1500;

/**
 * The "getting started" screen shown when a dataset has no telemetry yet.
 * Renders as a single-column documentation page — page title, language +
 * library picker, then the integration's numbered steps — using the same
 * scroll container, max-width, and typographic scale as the settings
 * panels so the guide feels like part of the same surface.
 *
 * Same component is used both as the in-place overlay on
 * `TelemetryTabPanel` (when the dataset has never received a log) and
 * inside the `LogStreamHeader` sheet (re-entry button for users who have
 * data flowing but want the snippets back).
 */
export function EmptyDatasetGuide({
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
    const firstLibrary = integrationRegistry.listLibraries(language)[0]?.id ?? "";
    setSelectedLibraryId(firstLibrary);
  };

  const protocolLabel = integration
    ? (PROTOCOL_LABEL[integration.protocol] ?? integration.protocol)
    : null;

  // Resolve the language's display label so the markdown heading reads
  // "Effect + …" rather than "effect + …".
  const languageLabel =
    integrationRegistry.listLanguages().find((meta) => meta.id === selectedLanguage)?.label ??
    selectedLanguage;

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
      <div className="flex-1 overflow-y-auto p-6 sm:p-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="font-semibold text-2xl text-foreground tracking-tight">
              Start sending telemetry to Lensflare
            </h1>
          </header>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-3">
            <div className="flex-1">
              <IntegrationPicker
                onLanguageChange={handleLanguageChange}
                onLibraryChange={setSelectedLibraryId}
                selectedLanguage={selectedLanguage}
                selectedLibraryId={selectedLibraryId}
              />
            </div>
            <CopyMarkdownButton
              integration={integration}
              languageLabel={languageLabel}
              variables={variables}
            />
          </div>

          {integration ? (
            <section className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] text-muted-foreground/80 leading-relaxed">
                  {integration.summary}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground/70 tracking-[0.04em]">
                  {[protocolLabel, ...integration.signals].filter(Boolean).join("  ·  ")}
                </p>
              </div>
              <IntegrationSteps integration={integration} variables={variables} />
              {integration.verifyHint ? (
                <p className="border-border/60 border-t pt-4 text-muted-foreground/70 text-xs leading-relaxed">
                  {integration.verifyHint}
                </p>
              ) : null}
            </section>
          ) : (
            <p className="text-muted-foreground text-sm">
              No integration guides are registered yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface CopyMarkdownButtonProps {
  integration: Integration | undefined;
  languageLabel: string;
  variables: TemplateVars;
}

/**
 * "Copy MD" affordance shown next to the page title. Renders the active
 * integration as a self-contained Markdown document via {@link
 * integrationToMarkdown} and writes it to the clipboard. The button
 * disables itself when the picker has no resolvable integration so it
 * never copies an empty document.
 */
function CopyMarkdownButton({ integration, languageLabel, variables }: CopyMarkdownButtonProps) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  // The integration / vars / label are captured in the click handler so
  // the user always copies the markdown for whatever they're currently
  // looking at, even after switching language or library.
  const handleCopy = useCallback(() => {
    if (!integration) {
      return;
    }
    const markdown = integrationToMarkdown(integration, variables, {
      languageLabel,
    });
    void navigator.clipboard
      .writeText(markdown)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = setTimeout(() => {
          setCopied(false);
          copyTimerRef.current = null;
        }, COPY_FEEDBACK_MS);
      })
      .catch(() => {
        // Clipboard can reject if the document isn't focused or the user
        // denied permission. We silently swallow it — the snippets below
        // remain copyable individually via their own buttons.
      });
  }, [integration, languageLabel, variables]);

  return (
    <Button
      aria-label={copied ? "Copied as Markdown" : "Copy guide as Markdown"}
      data-copied={copied}
      disabled={!integration}
      onClick={handleCopy}
      variant="outline"
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy MD"}
    </Button>
  );
}
