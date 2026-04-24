import type { Integration, Language, LanguageMeta, LibraryMeta } from "./types";

/**
 * Stable display order for the language tabs. Entries whose language does
 * not appear here are appended at the end so adding a new language never
 * silently drops it from the UI.
 */
export const LANGUAGE_ORDER: ReadonlyArray<LanguageMeta> = [
  { id: "node", label: "Node.js", sublabel: "TypeScript & JS" },
  { id: "effect", label: "Effect", sublabel: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "go", label: "Go" },
  { id: "browser", label: "Browser JS" },
  { id: "shell", label: "Shell / curl" },
];

/** Language + library id pair used by {@link IntegrationRegistry.find}. */
export interface FindIntegrationQuery {
  readonly language: Language;
  readonly libraryId: string;
}

/**
 * A read-only view over a fixed set of {@link Integration} entries. Split
 * from the module-level `createDefaultRegistry()` below so the selector
 * logic can be exercised with hand-built fixtures in tests without
 * reaching into `import.meta.glob`.
 */
export interface IntegrationRegistry {
  listAll(): ReadonlyArray<Integration>;
  listLanguages(): ReadonlyArray<LanguageMeta>;
  listIntegrations(language: Language): ReadonlyArray<Integration>;
  listLibraries(language: Language): ReadonlyArray<LibraryMeta>;
  find(query: FindIntegrationQuery): Integration | undefined;
  getDefault(): Integration | undefined;
}

/**
 * Build an {@link IntegrationRegistry} from an explicit list of entries.
 * Pure — does no filesystem or module lookup — so it's safe to use in
 * tests.
 */
export function createRegistry(
  entries: ReadonlyArray<Integration>,
): IntegrationRegistry {
  const allIntegrations = [...entries].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const integrationsByLanguage = new Map<Language, Array<Integration>>();
  for (const integration of allIntegrations) {
    const bucket = integrationsByLanguage.get(integration.language);
    if (bucket) {
      bucket.push(integration);
    } else {
      integrationsByLanguage.set(integration.language, [integration]);
    }
  }

  const listLanguages = (): ReadonlyArray<LanguageMeta> => {
    const known = LANGUAGE_ORDER.filter((meta) =>
      integrationsByLanguage.has(meta.id),
    );
    const unknownIds = [...integrationsByLanguage.keys()].filter(
      (id) => !LANGUAGE_ORDER.some((meta) => meta.id === id),
    );
    const unknown: Array<LanguageMeta> = unknownIds.map((id) => ({
      id,
      label: id,
    }));
    return [...known, ...unknown];
  };

  const listIntegrations = (
    language: Language,
  ): ReadonlyArray<Integration> => integrationsByLanguage.get(language) ?? [];

  const listLibraries = (language: Language): ReadonlyArray<LibraryMeta> =>
    listIntegrations(language)
      .map((integration) => integration.library)
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label));

  const find = (query: FindIntegrationQuery): Integration | undefined =>
    listIntegrations(query.language).find(
      (integration) => integration.library.id === query.libraryId,
    );

  /**
   * Default landing integration. Prefers Node + OpenTelemetry SDK because
   * that is the protocol we most want users to converge on; falls back to
   * the first registered entry if Node+OTel isn't present (e.g. stubbed
   * registries in tests).
   */
  const getDefault = (): Integration | undefined => {
    const nodeOtel = find({
      language: "node",
      libraryId: "opentelemetry-sdk",
    });
    return nodeOtel ?? allIntegrations[0];
  };

  return {
    listAll: () => allIntegrations,
    listLanguages,
    listIntegrations,
    listLibraries,
    find,
    getDefault,
  };
}

/**
 * Build the registry from the entries statically discovered via
 * `import.meta.glob`. Vite resolves this at build time, so adding a file
 * under `./entries/` surfaces a new integration with no other edits.
 */
function createDefaultRegistry(): IntegrationRegistry {
  const entryModules = import.meta.glob<{ default: Integration }>(
    "./entries/*.ts",
    { eager: true },
  );
  const entries = Object.values(entryModules).map((mod) => mod.default);
  return createRegistry(entries);
}

/** The process-wide registry used by the UI. */
export const integrationRegistry: IntegrationRegistry = createDefaultRegistry();
