import { integrationRegistry } from "~/integrations/registry";
import type { Language, LibraryMeta } from "~/integrations/types";
import { cn } from "~/lib/utils";

import { TopTabsItem, TopTabsList, TopTabsTrigger } from "../../ui/top-tabs";

interface IntegrationPickerProps {
  selectedLanguage: Language;
  selectedLibraryId: string;
  onLanguageChange: (language: Language) => void;
  onLibraryChange: (libraryId: string) => void;
}

/**
 * Two-level picker for the empty-dataset guide: language tabs on top,
 * library pills underneath. Fed directly from {@link integrationRegistry}
 * so adding a new integration surfaces automatically.
 *
 * Both controls are keyboard accessible via the underlying `TopTabsTrigger`
 * buttons; the library pill row uses the `role="tablist"` idiom but keeps
 * its own styling so it stays visually distinct from the top-level
 * language bar.
 */
export function IntegrationPicker({
  selectedLanguage,
  selectedLibraryId,
  onLanguageChange,
  onLibraryChange,
}: IntegrationPickerProps) {
  const languages = integrationRegistry.listLanguages();
  const libraries = integrationRegistry.listLibraries(selectedLanguage);

  return (
    <div className="flex flex-col">
      <TopTabsList className="px-4">
        {languages.map((meta) => (
          <TopTabsItem active={meta.id === selectedLanguage} key={meta.id}>
            <TopTabsTrigger
              active={meta.id === selectedLanguage}
              onClick={() => onLanguageChange(meta.id)}
            >
              {meta.label}
            </TopTabsTrigger>
          </TopTabsItem>
        ))}
      </TopTabsList>

      {libraries.length > 0 ? (
        <div
          aria-label="Library"
          className="flex flex-wrap items-center gap-2 px-4 py-3"
          role="tablist"
        >
          {libraries.map((library) => (
            <LibraryPill
              active={library.id === selectedLibraryId}
              key={library.id}
              library={library}
              onSelect={() => onLibraryChange(library.id)}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-sm text-muted-foreground">
          No integrations registered for this language yet.
        </div>
      )}
    </div>
  );
}

interface LibraryPillProps {
  active: boolean;
  library: LibraryMeta;
  onSelect: () => void;
}

function LibraryPill({ active, library, onSelect }: LibraryPillProps) {
  return (
    <button
      aria-selected={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active
          ? "border-foreground/20 bg-foreground text-background"
          : "border-border/70 bg-background text-muted-foreground hover:border-border hover:text-foreground",
      )}
      onClick={onSelect}
      role="tab"
      type="button"
    >
      {library.label}
    </button>
  );
}
