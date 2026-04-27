import { CheckIcon, CopyIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { integrationToMarkdown } from "~/integrations/markdown";
import { integrationRegistry, PROTOCOL_LABEL } from "~/integrations/registry";
import type { Integration, Language, TemplateVars } from "~/integrations/types";
import { copyTextToClipboard } from "~/lib/clipboard";

import { IntegrationPicker } from "./IntegrationPicker";
import { IntegrationSteps } from "./IntegrationSteps";

interface ConnectTabProps {
  projectSlug: string;
  datasetSlug: string;
  serverOrigin: string;
}

const COPY_FEEDBACK_MS = 1500;

/**
 * "Connect" dataset tab. Hosts the language + library picker and the
 * snippet-driven setup guide that used to be shown as the empty-state
 * overlay. Mounted directly by the dataset tab router in `LogStreamView`,
 * so the visual chrome (page padding, max-width column, h1 header)
 * matches a settings panel even though the route is dataset-scoped.
 */
export function ConnectTab({ projectSlug, datasetSlug, serverOrigin }: ConnectTabProps) {
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8 sm:px-8 sm:py-10">
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
        <p className="text-muted-foreground text-sm">No integration guides are registered yet.</p>
      )}
    </div>
  );
}

interface CopyMarkdownButtonProps {
  integration: Integration | undefined;
  languageLabel: string;
  variables: TemplateVars;
}

/**
 * "Copy MD" affordance shown next to the picker. Renders the active
 * integration as a self-contained Markdown document via {@link
 * integrationToMarkdown} and writes it to the clipboard. Disables when
 * no integration is resolvable so the button never copies an empty doc.
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

  const handleCopy = useCallback(() => {
    if (!integration) {
      return;
    }
    const markdown = integrationToMarkdown(integration, variables, {
      languageLabel,
    });
    void copyTextToClipboard(markdown)
      .then((success) => {
        if (!success) {
          return;
        }
        setCopied(true);
        if (copyTimerRef.current !== null) {
          clearTimeout(copyTimerRef.current);
        }
        copyTimerRef.current = setTimeout(() => {
          setCopied(false);
          copyTimerRef.current = null;
        }, COPY_FEEDBACK_MS);
      })
      .catch(() => {});
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
