import { ExternalLinkIcon, InfoIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const APP_NAME = "Lensflare";
const APP_VERSION = "0.1.0";

/**
 * Static "About" panel. Shows the current app version and a couple of helpful
 * links. Kept intentionally minimal — extend with release notes / diagnostics
 * once the app exposes that data.
 */
export function AboutSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection icon={<InfoIcon className="size-5" />} title="About">
        <SettingsRow
          control={
            <code className="text-[12px] text-muted-foreground tabular-nums">v{APP_VERSION}</code>
          }
          description={`The version of ${APP_NAME} currently running.`}
          title="Version"
        />
        <SettingsRow
          control={
            <code className="text-[12px] text-muted-foreground">
              {navigator.userAgent
                .match(/\(([^)]+)\)/)?.[1]
                ?.split(";")[0]
                ?.trim() ?? "Unknown"}
            </code>
          }
          description="The runtime environment this build is executing in."
          title="Platform"
        />
      </SettingsSection>

      <SettingsSection title="Resources">
        <SettingsRow
          control={
            <Button
              onClick={() => window.open("https://opentelemetry.io/docs/", "_blank", "noopener")}
              size="xs"
              variant="outline"
            >
              <ExternalLinkIcon className="size-3.5" />
              Open docs
            </Button>
          }
          description="Learn more about the OpenTelemetry data model that powers Lensflare."
          title="OpenTelemetry documentation"
        />
        <SettingsRow
          control={
            <Button
              onClick={() =>
                window.open("https://github.com/TheSpaceCompany/lensflare", "_blank", "noopener")
              }
              size="xs"
              variant="outline"
            >
              <ExternalLinkIcon className="size-3.5" />
              View source
            </Button>
          }
          description="Browse the source code, file issues, or suggest improvements."
          title="GitHub repository"
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
