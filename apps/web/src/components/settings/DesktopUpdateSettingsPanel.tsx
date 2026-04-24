import type { DesktopUpdateChannel } from "@lensflare/contracts";
import {
  BugIcon,
  CheckCircle2Icon,
  DownloadIcon,
  RefreshCwIcon,
  RotateCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  canCheckForUpdate,
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "~/components/desktopUpdate.logic";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  checkForDesktopUpdate,
  downloadDesktopUpdate,
  installDesktopUpdate,
  setDesktopUpdateChannel,
  useDesktopUpdateSnapshot,
} from "~/lib/desktopUpdateStore";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function formatCheckedAt(value: string | null): string {
  if (!value) {
    return "Not checked yet";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    available: "Update Available",
    checking: "Checking",
    disabled: "Unavailable",
    downloaded: "Ready to Install",
    downloading: "Downloading",
    error: "Needs Attention",
    idle: "Idle",
    "up-to-date": "Up to Date",
  };
  return labels[status] ?? status;
}

function getActionLabel(action: string, status: string): string {
  if (action === "download") return "Download";
  if (action === "install") return "Restart to Install";
  if (status === "checking") return "Checking...";
  return "Check for Updates";
}

function getActionIcon(action: string, status: string) {
  if (action === "download") return DownloadIcon;
  if (action === "install") return RotateCwIcon;
  if (status === "checking") return RefreshCwIcon;
  return CheckCircle2Icon;
}

export function DesktopUpdateSettingsPanel() {
  const { bridgeAvailable, initialized, state, error } = useDesktopUpdateSnapshot();
  const [busy, setBusy] = useState<"check" | "channel" | "action" | null>(null);

  const selectedChannel = state?.channel ?? "latest";
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const buttonTooltip = state ? getDesktopUpdateButtonTooltip(state) : null;
  const actionDisabled =
    !state ||
    busy !== null ||
    (action === "none" ? !canCheckForUpdate(state) : isDesktopUpdateButtonDisabled(state));
  const ActionIcon = getActionIcon(action, state?.status ?? "idle");
  const arm64Warning = state && shouldShowArm64IntelBuildWarning(state);
  const statusDescription = useMemo(() => {
    if (!state) {
      return initialized ? "Desktop updater state is unavailable." : "Loading desktop updater.";
    }
    if (state.message) {
      return state.message;
    }
    if (state.status === "available" && state.availableVersion) {
      return `Version ${state.availableVersion} is ready to download.`;
    }
    if (state.status === "downloaded" && state.downloadedVersion) {
      return `Version ${state.downloadedVersion} has been downloaded.`;
    }
    return "Manual update checks, downloads, and installs are controlled here.";
  }, [initialized, state]);

  const handleChannelChange = useCallback(
    (channel: DesktopUpdateChannel) => {
      if (channel === selectedChannel) {
        return;
      }
      setBusy("channel");
      void setDesktopUpdateChannel(channel)
        .catch((err: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not change update track",
              description: err instanceof Error ? err.message : "Update track change failed.",
            }),
          );
        })
        .finally(() => setBusy(null));
    },
    [selectedChannel],
  );

  const handleAction = useCallback(() => {
    if (!state || busy !== null) {
      return;
    }

    if (action === "download") {
      setBusy("action");
      void downloadDesktopUpdate()
        .then((result) => {
          if (!result) return;
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart Lensflare to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const message = getDesktopUpdateActionError(result);
          if (!message) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: message,
            }),
          );
        })
        .catch((err: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: err instanceof Error ? err.message : "Download failed.",
            }),
          );
        })
        .finally(() => setBusy(null));
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(getDesktopUpdateInstallConfirmationMessage(state));
      if (!confirmed) return;
      setBusy("action");
      void installDesktopUpdate()
        .then((result) => {
          if (!result || !shouldToastDesktopUpdateActionResult(result)) return;
          const message = getDesktopUpdateActionError(result);
          if (!message) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: message,
            }),
          );
        })
        .catch((err: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not install update",
              description: err instanceof Error ? err.message : "Install failed.",
            }),
          );
        })
        .finally(() => setBusy(null));
      return;
    }

    setBusy("check");
    void checkForDesktopUpdate()
      .then((result) => {
        if (!result) return;
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not check for updates",
              description: result.state.message ?? "Updates are unavailable in this build.",
            }),
          );
          return;
        }
        if (result.state.status === "up-to-date") {
          toastManager.add({
            type: "success",
            title: "Lensflare is up to date",
            description: `Version ${result.state.currentVersion} is the newest available version.`,
          });
        }
      })
      .catch((err: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not check for updates",
            description: err instanceof Error ? err.message : "Update check failed.",
          }),
        );
      })
      .finally(() => setBusy(null));
  }, [action, busy, state]);

  if (!bridgeAvailable && !initialized) {
    return (
      <SettingsPageContainer>
        <SettingsSection icon={<RefreshCwIcon className="size-5" />} title="Desktop Updates">
          <SettingsRow description="Loading desktop updater state." title="Updates" />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  if (!bridgeAvailable) {
    return (
      <SettingsPageContainer>
        <SettingsSection icon={<RefreshCwIcon className="size-5" />} title="Desktop Updates">
          <SettingsRow
            description="Auto-update controls are available only in the packaged Lensflare desktop app."
            title="Desktop only"
          />
        </SettingsSection>
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection icon={<RefreshCwIcon className="size-5" />} title="Desktop Updates">
        <SettingsRow
          control={
            <code className="text-[12px] text-muted-foreground tabular-nums">
              v{state?.currentVersion ?? "Unknown"}
            </code>
          }
          description="The packaged desktop version currently running."
          title="Current version"
        />
        <SettingsRow
          control={
            <Select
              onValueChange={(value) => handleChannelChange(value as DesktopUpdateChannel)}
              value={selectedChannel}
            >
              <SelectTrigger
                aria-label="Update track"
                className="w-full sm:w-40"
                disabled={!state || busy !== null}
              >
                <SelectValue>{selectedChannel === "nightly" ? "Nightly" : "Stable"}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  Stable
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  Nightly
                </SelectItem>
              </SelectPopup>
            </Select>
          }
          description="Stable follows public releases. Nightly follows prerelease desktop builds."
          title="Update track"
        />
        <SettingsRow
          control={
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    disabled={actionDisabled}
                    onClick={handleAction}
                    size="xs"
                    variant={action === "install" ? "default" : "outline"}
                  >
                    <ActionIcon className="size-3.5" />
                    {getActionLabel(action, state?.status ?? "idle")}
                  </Button>
                }
              />
              {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
            </Tooltip>
          }
          description={statusDescription}
          status={
            <span className="inline-flex items-center gap-1.5">
              {state ? formatStatus(state.status) : initialized ? "Unavailable" : "Loading"}
              <span className="text-muted-foreground/70">
                Last checked: {formatCheckedAt(state?.checkedAt ?? null)}
              </span>
            </span>
          }
          title="Status"
        />
      </SettingsSection>

      {arm64Warning ? (
        <SettingsSection icon={<TriangleAlertIcon className="size-5" />} title="Architecture">
          <SettingsRow
            description={getArm64IntelBuildWarningDescription(state)}
            title="Intel build on Apple Silicon"
          />
        </SettingsSection>
      ) : null}

      {error ? (
        <SettingsSection icon={<BugIcon className="size-5" />} title="Diagnostics">
          <SettingsRow description={error} title="Updater bridge error" />
        </SettingsSection>
      ) : null}
    </SettingsPageContainer>
  );
}
