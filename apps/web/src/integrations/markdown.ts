import { PROTOCOL_LABEL } from "./registry";
import { renderTemplate } from "./template";
import type { Integration, TemplateVars } from "./types";

export interface IntegrationMarkdownOptions {
  /**
   * Human-readable language label (e.g. "Node.js", "Effect"). Falls back
   * to the raw `integration.language` id when omitted so the function is
   * usable from contexts that haven't already resolved a {@link
   * LanguageMeta}.
   */
  readonly languageLabel?: string;
}

/**
 * Render a single integration as a self-contained Markdown document.
 *
 * The output is intentionally simple — `# heading`, fenced code blocks,
 * `>` blockquotes for notes — so it pastes cleanly into GitHub issues,
 * READMEs, or any standard renderer. Snippet placeholders are
 * substituted via {@link renderTemplate} before fencing so the copy
 * matches what the user is currently looking at on screen.
 */
export function integrationToMarkdown(
  integration: Integration,
  vars: TemplateVars,
  options: IntegrationMarkdownOptions = {},
): string {
  const languageLabel = options.languageLabel ?? integration.language;
  const lines: Array<string> = [];

  lines.push(`# ${languageLabel} + ${integration.library.label}`);
  lines.push("");

  if (integration.summary) {
    lines.push(integration.summary);
    lines.push("");
  }

  const metaParts: Array<string> = [
    `**Protocol:** ${PROTOCOL_LABEL[integration.protocol] ?? integration.protocol}`,
  ];
  if (integration.signals.length > 0) {
    metaParts.push(`**Signals:** ${integration.signals.join(", ")}`);
  }
  lines.push(metaParts.join(" · "));
  lines.push("");

  integration.steps.forEach((step, index) => {
    lines.push(`## ${index + 1}. ${step.title}`);
    lines.push("");

    if (step.body) {
      lines.push(step.body);
      lines.push("");
    }

    if (step.snippet) {
      if (step.snippet.filename) {
        lines.push(`*${step.snippet.filename}*`);
        lines.push("");
      }
      lines.push("```" + step.snippet.lang);
      lines.push(renderTemplate(step.snippet.code, vars).replace(/\n+$/, ""));
      lines.push("```");
      lines.push("");
    }

    if (step.note) {
      // Multi-line notes become multi-line blockquotes so each line still
      // renders as quoted text and a stray paragraph break can't escape
      // the quote.
      for (const noteLine of step.note.split("\n")) {
        lines.push(`> ${noteLine}`);
      }
      lines.push("");
    }
  });

  if (integration.verifyHint) {
    lines.push("---");
    lines.push("");
    lines.push(integration.verifyHint);
    lines.push("");
  }

  // Collapse trailing blank lines into a single terminating newline so
  // the document round-trips cleanly through clipboard managers that
  // strip trailing whitespace.
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
