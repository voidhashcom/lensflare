import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useTheme, type Theme } from "~/hooks/useTheme";

import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/**
 * Appearance panel for preferences that are wired into the app.
 */
export function AppearanceSettingsPanel() {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Theme">
        <SettingsRow
          control={
            <Select
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
              value={theme}
            >
              <SelectTrigger aria-label="Theme preference" className="w-full sm:w-40">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          description="Choose how Lensflare looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="Theme" onClick={() => setTheme("system")} />
            ) : undefined
          }
          title="Color theme"
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
