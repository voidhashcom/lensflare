import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { integrationRegistry } from "~/integrations/registry";
import { INTEGRATION_LOGOS, type LogoComponent } from "~/integrations/logos";
import type { Language, LanguageMeta, LibraryMeta, LogoId } from "~/integrations/types";

interface IntegrationPickerProps {
  selectedLanguage: Language;
  selectedLibraryId: string;
  onLanguageChange: (language: Language) => void;
  onLibraryChange: (libraryId: string) => void;
}

/**
 * Two-column language + library picker. Each column is a labelled
 * `Select` so the picker shares its visual language with the settings
 * panels, and every option carries the matching brand mark on its left
 * for at-a-glance scanning. Fed directly from {@link integrationRegistry}
 * so adding a new integration surfaces automatically.
 */
export function IntegrationPicker({
  selectedLanguage,
  selectedLibraryId,
  onLanguageChange,
  onLibraryChange,
}: IntegrationPickerProps) {
  const languages = integrationRegistry.listLanguages();
  const libraries = integrationRegistry.listLibraries(selectedLanguage);
  const selectedLanguageMeta = languages.find((meta) => meta.id === selectedLanguage);
  const selectedLibraryMeta = libraries.find((library) => library.id === selectedLibraryId);

  return (
    <div className="flex">
      <PickerField label="Language">
        <Select
          onValueChange={(value) => onLanguageChange(value as Language)}
          value={selectedLanguage}
        >
          <SelectTrigger
            aria-label="Language"
            className="w-full justify-between rounded-r-none border-r-0"
          >
            <SelectValue>
              <LanguageOption meta={selectedLanguageMeta} />
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start">
            {languages.map((meta) => (
              <SelectItem hideIndicator key={meta.id} value={meta.id}>
                <LanguageOption meta={meta} />
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </PickerField>
      <PickerField label="Library">
        <Select
          disabled={libraries.length === 0}
          onValueChange={(value) => {
            if (typeof value === "string") {
              onLibraryChange(value);
            }
          }}
          value={selectedLibraryId}
        >
          <SelectTrigger aria-label="Library" className="w-full justify-between rounded-l-none">
            <SelectValue>
              {selectedLibraryMeta ? (
                <LibraryOption library={selectedLibraryMeta} />
              ) : (
                <span className="text-muted-foreground">No libraries available</span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="start">
            {libraries.map((library) => (
              <SelectItem hideIndicator key={library.id} value={library.id}>
                <LibraryOption library={library} />
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </PickerField>
    </div>
  );
}

interface PickerFieldProps {
  label: string;
  children: React.ReactNode;
}

function PickerField({ label, children }: PickerFieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-semibold text-[11px] sr-only text-muted-foreground uppercase tracking-[0.08em]">
        {label}
      </span>
      {children}
    </label>
  );
}

function LanguageOption({ meta }: { meta: LanguageMeta | undefined }) {
  if (!meta) {
    return <span className="text-muted-foreground">Choose a language</span>;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <LogoMark logoId={meta.logo} />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

function LibraryOption({ library }: { library: LibraryMeta }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <LogoMark logoId={library.logo} />
      <span className="truncate">{library.label}</span>
    </span>
  );
}

/**
 * Render the brand mark for a logo id, falling back to a neutral
 * placeholder so options without a registered logo still align with the
 * rest of the list.
 */
function LogoMark({ logoId }: { logoId: LogoId | undefined }) {
  const Logo: LogoComponent | undefined = logoId ? INTEGRATION_LOGOS[logoId] : undefined;
  if (!Logo) {
    return (
      <span
        aria-hidden="true"
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[9px] text-muted-foreground"
      >
        •
      </span>
    );
  }
  return <Logo className="size-4 shrink-0" />;
}
