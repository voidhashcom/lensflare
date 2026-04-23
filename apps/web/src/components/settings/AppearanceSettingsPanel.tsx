import { PaletteIcon } from "lucide-react";
import { useState } from "react";

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";

import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

type DensityValue = "comfortable" | "compact";
type RowHeightValue = "sm" | "md" | "lg";

const DEFAULTS = {
  density: "comfortable" as DensityValue,
  rowHeight: "md" as RowHeightValue,
  showSidebarSearch: true,
  monospaceBody: false,
} as const;

const DENSITY_OPTIONS: ReadonlyArray<{ value: DensityValue; label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const ROW_HEIGHT_OPTIONS: ReadonlyArray<{ value: RowHeightValue; label: string }> = [
  { value: "sm", label: "Small" },
  { value: "md", label: "Medium" },
  { value: "lg", label: "Large" },
];

/**
 * Appearance panel — knobs that change how dense the UI feels and how log
 * rows are rendered. Mirrors the visual layout used in `GeneralSettingsPanel`
 * so every settings route feels consistent.
 */
export function AppearanceSettingsPanel() {
  const [density, setDensity] = useState<DensityValue>(DEFAULTS.density);
  const [rowHeight, setRowHeight] = useState<RowHeightValue>(DEFAULTS.rowHeight);
  const [showSidebarSearch, setShowSidebarSearch] = useState<boolean>(DEFAULTS.showSidebarSearch);
  const [monospaceBody, setMonospaceBody] = useState<boolean>(DEFAULTS.monospaceBody);

  return (
    <SettingsPageContainer>
      <SettingsSection icon={<PaletteIcon className="size-3" />} title="Layout">
        <SettingsRow
          control={
            <Select onValueChange={(value) => setDensity(value as DensityValue)} value={density}>
              <SelectTrigger aria-label="Sidebar density" className="w-full sm:w-40">
                <SelectValue>
                  {DENSITY_OPTIONS.find((option) => option.value === density)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {DENSITY_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          description="Controls spacing in the sidebar and toolbar."
          resetAction={
            density !== DEFAULTS.density ? (
              <SettingResetButton
                label="Sidebar density"
                onClick={() => setDensity(DEFAULTS.density)}
              />
            ) : undefined
          }
          title="Sidebar density"
        />
        <SettingsRow
          control={<Switch checked={showSidebarSearch} onCheckedChange={setShowSidebarSearch} />}
          description="Show the search row at the top of the sidebar."
          resetAction={
            showSidebarSearch !== DEFAULTS.showSidebarSearch ? (
              <SettingResetButton
                label="Show sidebar search"
                onClick={() => setShowSidebarSearch(DEFAULTS.showSidebarSearch)}
              />
            ) : undefined
          }
          title="Show sidebar search"
        />
      </SettingsSection>

      <SettingsSection title="Log stream">
        <SettingsRow
          control={
            <Select
              onValueChange={(value) => setRowHeight(value as RowHeightValue)}
              value={rowHeight}
            >
              <SelectTrigger aria-label="Row height" className="w-full sm:w-40">
                <SelectValue>
                  {ROW_HEIGHT_OPTIONS.find((option) => option.value === rowHeight)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {ROW_HEIGHT_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          description="How tall each log row should be in the stream view."
          resetAction={
            rowHeight !== DEFAULTS.rowHeight ? (
              <SettingResetButton
                label="Row height"
                onClick={() => setRowHeight(DEFAULTS.rowHeight)}
              />
            ) : undefined
          }
          title="Row height"
        />
        <SettingsRow
          control={<Switch checked={monospaceBody} onCheckedChange={setMonospaceBody} />}
          description="Render log bodies and attribute values in a monospace typeface."
          resetAction={
            monospaceBody !== DEFAULTS.monospaceBody ? (
              <SettingResetButton
                label="Monospace log body"
                onClick={() => setMonospaceBody(DEFAULTS.monospaceBody)}
              />
            ) : undefined
          }
          title="Monospace log body"
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
