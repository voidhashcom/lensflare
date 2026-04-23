/**
 * Type model for the empty-dataset integration guide.
 *
 * An {@link Integration} describes how a specific language + library
 * combination sends telemetry to Lensflare. Each `Integration` is authored
 * as a standalone TS module under `./entries/` and picked up by the
 * {@link ./registry} at build time — adding a new one is a one-file change
 * that needs no UI edits.
 *
 * Code snippets keep `{{projectSlug}}`, `{{datasetSlug}}`,
 * `{{serverOrigin}}`, and `{{bearerToken}}` placeholders in their source.
 * Substitution happens at render time (see `./template.ts`) so the same
 * entry works across environments and reflects slug renames immediately.
 */

/** The telemetry signals an integration can emit. */
export type Signal = "logs" | "traces" | "metrics";

/**
 * The wire protocol the snippet uses to reach Lensflare. This is
 * informational — the routing is baked into the snippet itself — but it
 * lets the UI surface a small badge next to each library.
 */
export type Protocol = "otlp-http" | "axiom-native" | "curl";

/** The programming language / runtime the snippet targets. */
export type Language =
  | "node"
  | "effect"
  | "python"
  | "go"
  | "browser"
  | "shell";

/** Human-facing description of a language for tab labels, icons, etc. */
export interface LanguageMeta {
  readonly id: Language;
  readonly label: string;
  /** Short sublabel shown in the language tab (e.g. "TypeScript"). */
  readonly sublabel?: string;
}

/** The shiki-compatible language grammar id for a given snippet. */
export type SnippetLang =
  | "bash"
  | "ts"
  | "tsx"
  | "js"
  | "python"
  | "go"
  | "json";

/** A single copy-pastable code block inside a step. */
export interface Snippet {
  readonly lang: SnippetLang;
  /** Optional filename label shown above the code (e.g. `otel.ts`). */
  readonly filename?: string;
  /** Raw source with `{{varName}}` placeholders; substituted at render time. */
  readonly code: string;
}

/** One step in an integration walk-through. */
export interface Step {
  readonly title: string;
  /**
   * Optional plain-text paragraph(s) shown under the title. Kept free of
   * markup so we never have to evaluate markdown client-side — if we want
   * richer prose later we can switch to `ReactNode`.
   */
  readonly body?: string;
  readonly snippet?: Snippet;
  /**
   * Optional muted helper line shown below the snippet (e.g. "You should
   * see logs appear in the live tab within a few seconds").
   */
  readonly note?: string;
}

/** Metadata about the library / framework the snippet uses. */
export interface LibraryMeta {
  /** Stable registry-unique id (e.g. `"opentelemetry-sdk"`, `"pino"`). */
  readonly id: string;
  /** Display name shown in the library picker pill. */
  readonly label: string;
  /** Optional docs/homepage link shown on hover. */
  readonly homepageUrl?: string;
}

/** A single integration entry. One module per file under `./entries/`. */
export interface Integration {
  /** Stable registry-unique id (e.g. `"node-opentelemetry"`). */
  readonly id: string;
  readonly language: Language;
  readonly library: LibraryMeta;
  readonly protocol: Protocol;
  readonly signals: ReadonlyArray<Signal>;
  /** One-sentence blurb shown under the picker. */
  readonly summary: string;
  readonly steps: ReadonlyArray<Step>;
  /**
   * Optional hint rendered in the guide footer (e.g. "After running this,
   * you should see logs stream in below within a few seconds").
   */
  readonly verifyHint?: string;
}

/**
 * Runtime values substituted into snippets. Keyed by the bare placeholder
 * name (without braces) so `{{projectSlug}}` resolves from
 * `vars.projectSlug`.
 */
export interface TemplateVars {
  readonly projectSlug: string;
  readonly datasetSlug: string;
  readonly serverOrigin: string;
  /**
   * The Axiom-native endpoint uses `Authorization: Bearer <projectSlug>`,
   * so by convention `bearerToken === projectSlug`. Kept as its own var so
   * snippets can read as ordinary auth flows rather than hard-coding the
   * slug-as-token quirk.
   */
  readonly bearerToken: string;
}
