import { SettingsIcon } from "lucide-react";
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

type ThemeValue = "system" | "light" | "dark";
type TimestampValue = "locale" | "12-hour" | "24-hour";

const DEFAULTS = {
  theme: "system" as ThemeValue,
  timestampFormat: "locale" as TimestampValue,
  autoRefresh: true,
  confirmDelete: true,
  streamTailing: true,
} as const;

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeValue; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const TIMESTAMP_OPTIONS: ReadonlyArray<{ value: TimestampValue; label: string }> = [
  { value: "locale", label: "System default" },
  { value: "12-hour", label: "12-hour" },
  { value: "24-hour", label: "24-hour" },
];

/**
 * General preferences panel — theme, timestamp format, and a handful of
 * dataset / stream behaviours. Values are held in local component state for
 * now; wiring them to persistent storage can happen once the settings
 * contract lands on the server.
 */
export function GeneralSettingsPanel() {
  const [theme, setTheme] = useState<ThemeValue>(DEFAULTS.theme);
  const [timestampFormat, setTimestampFormat] = useState<TimestampValue>(DEFAULTS.timestampFormat);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(DEFAULTS.autoRefresh);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(DEFAULTS.confirmDelete);
  const [streamTailing, setStreamTailing] = useState<boolean>(DEFAULTS.streamTailing);

  return (
    <SettingsPageContainer>
      <SettingsSection icon={<SettingsIcon className="size-3" />} title="General">
        <SettingsRow
          control={
            <Select onValueChange={(value) => setTheme(value as ThemeValue)} value={theme}>
              <SelectTrigger aria-label="Theme" className="w-full sm:w-40">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label}
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
            theme !== DEFAULTS.theme ? (
              <SettingResetButton label="Theme" onClick={() => setTheme(DEFAULTS.theme)} />
            ) : undefined
          }
          title="Theme"
        />
        <SettingsRow
          control={
            <Select
              onValueChange={(value) => setTimestampFormat(value as TimestampValue)}
              value={timestampFormat}
            >
              <SelectTrigger aria-label="Time format" className="w-full sm:w-40">
                <SelectValue>
                  {TIMESTAMP_OPTIONS.find((option) => option.value === timestampFormat)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {TIMESTAMP_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          description="How timestamps appear in log rows and relative time labels."
          resetAction={
            timestampFormat !== DEFAULTS.timestampFormat ? (
              <SettingResetButton
                label="Time format"
                onClick={() => setTimestampFormat(DEFAULTS.timestampFormat)}
              />
            ) : undefined
          }
          title="Time format"
        />
      </SettingsSection>

      <SettingsSection title="Datasets">
        <SettingsRow
          control={<Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />}
          description="Refetch dataset stats in the background when a project is open."
          resetAction={
            autoRefresh !== DEFAULTS.autoRefresh ? (
              <SettingResetButton
                label="Auto-refresh datasets"
                onClick={() => setAutoRefresh(DEFAULTS.autoRefresh)}
              />
            ) : undefined
          }
          title="Auto-refresh datasets"
        />
        <SettingsRow
          control={<Switch checked={streamTailing} onCheckedChange={setStreamTailing} />}
          description="When a log stream is opened, keep it pinned to the latest records as they arrive."
          resetAction={
            streamTailing !== DEFAULTS.streamTailing ? (
              <SettingResetButton
                label="Follow new logs"
                onClick={() => setStreamTailing(DEFAULTS.streamTailing)}
              />
            ) : undefined
          }
          title="Follow new logs"
        />
        <SettingsRow
          control={<Switch checked={confirmDelete} onCheckedChange={setConfirmDelete} />}
          description="Ask for confirmation before removing a project or collection."
          resetAction={
            confirmDelete !== DEFAULTS.confirmDelete ? (
              <SettingResetButton
                label="Confirm destructive actions"
                onClick={() => setConfirmDelete(DEFAULTS.confirmDelete)}
              />
            ) : undefined
          }
          title="Confirm destructive actions"
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
