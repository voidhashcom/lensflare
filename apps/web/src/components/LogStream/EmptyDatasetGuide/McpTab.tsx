import {
  buildMcpClientGuides,
  PLUGIN_MARKETPLACE_REPO,
  type McpClientGuide,
} from "@lensflare/shared/mcp-clients";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CodeBlock } from "~/components/CodeBlock/CodeBlock";
import { Button } from "~/components/ui/button";
import { useLocalServerState } from "~/hooks/useLocalServerState";
import { copyTextToClipboard } from "~/lib/clipboard";
import { cn } from "~/lib/utils";

interface McpTabProps {
  /**
   * Live MCP URL the desktop shell is currently exposing
   * (`BackendTarget.mcpUrl`). Drives the copy block, the snippet templates,
   * and the verify text — everything stays in sync if the user overrides
   * the port via `LENSFLARE_SERVER_PORT`.
   */
  mcpUrl: string;
}

const COPY_FEEDBACK_MS = 1500;
const DOCS_URL = "https://lensflare.dev/docs/mcp";

/**
 * Map the shared `mcpClients` snippet `kind` (pure data, no shiki) onto
 * the `SnippetLang` accepted by the in-app `CodeBlock`. The two share a
 * dictionary on purpose — we want one source of truth for the install
 * payloads.
 */
function snippetLang(kind: "shell" | "json"): "bash" | "json" {
  return kind === "shell" ? "bash" : "json";
}

/**
 * "MCP" dataset tab. Shows the live MCP URL, the desktop server's
 * status, and per-client install snippets. App-scoped — the same
 * content renders regardless of which dataset the user navigated from.
 */
export function McpTab({ mcpUrl }: McpTabProps) {
  const guides = useMemo(() => buildMcpClientGuides(mcpUrl), [mcpUrl]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-10 sm:px-8 sm:py-12">
      <header className="flex flex-col gap-3 border-border/60 border-b pb-6">
        <h1 className="font-semibold text-[28px] text-foreground leading-tight tracking-tight">
          Lensflare MCP
        </h1>
        <p className="max-w-2xl text-muted-foreground text-sm leading-6">
          Connect Claude Code, Cursor, Codex, and other agents to your local Lensflare server over
          MCP. No cloud round-trip, no auth.
        </p>
      </header>

      <McpStatusRow mcpUrl={mcpUrl} />

      <McpClientGuides guides={guides} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-border/60 border-t pt-6">
        <p className="max-w-xl text-muted-foreground text-sm leading-6">
          Need a harness that's not listed? File an issue at{" "}
          <a
            className="underline underline-offset-2 transition-colors hover:text-foreground"
            href={`https://github.com/${PLUGIN_MARKETPLACE_REPO}/issues/new`}
            rel="noreferrer noopener"
            target="_blank"
          >
            {PLUGIN_MARKETPLACE_REPO}
          </a>
          .
        </p>
        <Button onClick={() => window.open(DOCS_URL, "_blank", "noopener")} variant="outline">
          <ExternalLinkIcon />
          Open full docs
        </Button>
      </div>
    </div>
  );
}

interface McpStatusRowProps {
  mcpUrl: string;
}

/**
 * URL + copy + status pill. Status mirrors the desktop
 * lifecycle so a port-in-use failure surfaces the same actionable line as
 * the main-process dialog.
 */
function McpStatusRow({ mcpUrl }: McpStatusRowProps) {
  const serverState = useLocalServerState();
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
    void copyTextToClipboard(mcpUrl)
      .then((success) => {
        if (!success) return;
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
  }, [mcpUrl]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <code className="flex-1 select-all overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-3.5 py-2.5 font-mono text-[12px] text-foreground leading-6">
          {mcpUrl}
        </code>
        <div className="flex items-center gap-2">
          <Button
            aria-label={copied ? "Copied MCP URL" : "Copy MCP URL"}
            data-copied={copied}
            onClick={handleCopy}
            variant="outline"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy URL"}
          </Button>
        </div>
      </div>
      <McpStatusPill state={serverState} />
    </section>
  );
}

interface McpStatusPillProps {
  state: ReturnType<typeof useLocalServerState>;
}

function McpStatusPill({ state }: McpStatusPillProps) {
  const { tone, label, detail } = describeServerState(state);
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted-foreground/80 leading-6">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          tone === "ready" && "bg-green-500",
          tone === "starting" && "bg-amber-400 animate-pulse",
          tone === "failed" && "bg-red-500",
          tone === "unknown" && "bg-muted-foreground/40",
        )}
      />
      <span className="font-mono uppercase tracking-[0.06em]">{label}</span>
      {detail ? <span className="truncate text-muted-foreground/70">{detail}</span> : null}
    </div>
  );
}

function describeServerState(state: ReturnType<typeof useLocalServerState>): {
  tone: "ready" | "starting" | "failed" | "unknown";
  label: string;
  detail?: string;
} {
  if (state === null) {
    // We're outside the desktop shell — the MCP is whatever this web bundle
    // is talking to. The status pill becomes informational rather than a
    // live mirror of the desktop main process.
    return {
      tone: "unknown",
      label: "Status unavailable",
      detail: "Open the desktop app to see live state.",
    };
  }
  switch (state.status) {
    case "ready":
      return { tone: "ready", label: "Running" };
    case "starting":
      return { tone: "starting", label: "Starting…" };
    case "restarting":
      return { tone: "starting", label: "Restarting…" };
    case "failed":
      return {
        tone: "failed",
        label: "Failed",
        detail: state.message,
      };
  }
}

interface McpClientGuidesProps {
  guides: ReadonlyArray<McpClientGuide>;
}

function McpClientGuides({ guides }: McpClientGuidesProps) {
  return (
    <div className="flex flex-col">
      {guides.map((guide) => (
        <section
          className="flex flex-col gap-4 border-border/60 border-t pt-8 pb-3 first:border-t-0 first:pt-0"
          key={guide.id}
        >
          <h3 className="font-semibold text-[15px] text-foreground leading-6">
            {guide.label}
          </h3>
          <p className="max-w-2xl text-muted-foreground text-sm leading-6">{guide.summary}</p>
          {guide.steps.map((step, stepIndex) => (
            <div className="flex flex-col gap-3" key={`${guide.id}-step-${stepIndex}`}>
              {step.body ? (
                <p className="max-w-2xl whitespace-pre-line text-foreground/75 text-sm leading-7">
                  {step.body}
                </p>
              ) : null}
              {step.snippet ? (
                <CodeBlock
                  snippet={{
                    lang: snippetLang(step.snippet.kind),
                    ...(step.snippet.filename ? { filename: step.snippet.filename } : {}),
                    code: step.snippet.code,
                  }}
                  variables={EMPTY_VARS}
                />
              ) : null}
            </div>
          ))}
          <p className="max-w-2xl text-muted-foreground text-sm leading-6">
            <strong className="font-medium text-foreground/90">Verify:</strong> {guide.verification}
          </p>
        </section>
      ))}
    </div>
  );
}

/**
 * Snippets in the MCP tab carry the URL inline — they don't use template
 * placeholders — so we hand `CodeBlock` an empty variables map. Kept as a
 * named constant so the intent is obvious to anyone diffing this file.
 */
const EMPTY_VARS = {
  projectSlug: "",
  datasetSlug: "",
  serverOrigin: "",
  bearerToken: "",
} as const;
