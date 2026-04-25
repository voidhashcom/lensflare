import { APP_NAME, APP_VERSION } from "@lensflare/shared/browser";
import { ExternalLinkIcon } from "lucide-react";

import { Button } from "~/components/ui/button";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

/**
 * Static "About" panel. Shows the current app version and a couple of helpful
 * links. Kept intentionally minimal — extend with release notes / diagnostics
 * once the app exposes that data.
 */
export function AboutSettingsPanel() {
  return (
    <SettingsPageContainer>
      <SettingsSection title="About">
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
              onClick={() => window.open("https://lensflare.dev", "_blank", "noopener")}
              size="xs"
              variant="outline"
            >
              <ExternalLinkIcon className="size-3.5" />
              Open site
            </Button>
          }
          description="Visit the Lensflare website for product information and updates."
          title="Lensflare website"
        />
        <SettingsRow
          control={
            <Button
              onClick={() =>
                window.open("https://github.com/voidhashcom/lensflare", "_blank", "noopener")
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
