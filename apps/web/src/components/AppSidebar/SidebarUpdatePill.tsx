import { DownloadIcon, RotateCwIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useCallback, useState } from "react";

import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "~/components/desktopUpdate.logic";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import {
  downloadDesktopUpdate,
  installDesktopUpdate,
  useDesktopUpdateSnapshot,
} from "~/lib/desktopUpdateStore";
import { cn } from "~/lib/utils";

export function SidebarUpdatePill() {
  const { bridgeAvailable, state } = useDesktopUpdateSnapshot();
  const [dismissed, setDismissed] = useState(false);

  const isDesktop = bridgeAvailable;
  const visible = isDesktop && shouldShowDesktopUpdateButton(state) && !dismissed;
  const tooltip = state ? getDesktopUpdateButtonTooltip(state) : "Update available";
  const disabled = isDesktopUpdateButtonDisabled(state);
  const action = state ? resolveDesktopUpdateButtonAction(state) : "none";
  const showArm64Warning = isDesktop && shouldShowArm64IntelBuildWarning(state);
  const arm64Description =
    state && showArm64Warning ? getArm64IntelBuildWarningDescription(state) : null;

  const handleAction = useCallback(() => {
    if (!state || disabled || action === "none") {
      return;
    }

    if (action === "download") {
      void downloadDesktopUpdate()
        .then((result) => {
          if (!result) return;
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart Lensflare from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not download update",
              description: actionError,
            }),
          );
        })
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not start update download",
              description: error instanceof Error ? error.message : "An unexpected error occurred.",
            }),
          );
        });
      return;
    }

    const confirmed = window.confirm(getDesktopUpdateInstallConfirmationMessage(state));
    if (!confirmed) {
      return;
    }

    void installDesktopUpdate()
      .then((result) => {
        if (!result || !shouldToastDesktopUpdateActionResult(result)) return;
        const actionError = getDesktopUpdateActionError(result);
        if (!actionError) return;
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not install update",
            description: actionError,
          }),
        );
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          }),
        );
      });
  }, [action, disabled, state]);

  if (!visible && !showArm64Warning) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {showArm64Warning && arm64Description ? (
        <Alert className="rounded-lg px-2.5 py-2 text-xs" variant="warning">
          <TriangleAlertIcon className="size-3.5" />
          <AlertTitle className="text-xs">Intel build on Apple Silicon</AlertTitle>
          <AlertDescription className="text-[11px] leading-relaxed">
            {arm64Description}
          </AlertDescription>
        </Alert>
      ) : null}

      {visible ? (
        <div
          className={cn(
            "group/update relative flex h-7 w-full items-center rounded-lg bg-primary/12 text-primary text-xs font-medium",
            disabled ? "cursor-not-allowed opacity-60" : "",
          )}
        >
          <div className="pointer-events-none absolute inset-0 rounded-lg transition-colors group-has-[button.update-main:hover]/update:bg-primary/20" />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  aria-disabled={disabled || undefined}
                  aria-label={tooltip}
                  className="update-main relative flex h-full flex-1 items-center gap-2 px-2 enabled:"
                  disabled={disabled}
                  onClick={handleAction}
                  type="button"
                >
                  {action === "install" ? (
                    <>
                      <RotateCwIcon className="size-3.5" />
                      <span>Restart to update</span>
                    </>
                  ) : state?.status === "downloading" ? (
                    <>
                      <DownloadIcon className="size-3.5" />
                      <span>
                        Downloading
                        {typeof state.downloadPercent === "number"
                          ? ` (${Math.floor(state.downloadPercent)}%)`
                          : "..."}
                      </span>
                    </>
                  ) : (
                    <>
                      <DownloadIcon className="size-3.5" />
                      <span>Update available</span>
                    </>
                  )}
                </button>
              }
            />
            <TooltipPopup side="top">{tooltip}</TooltipPopup>
          </Tooltip>

          {action === "download" ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Dismiss update"
                    className="relative mr-1"
                    onClick={() => setDismissed(true)}
                    size="icon"
                    variant="ghost"
                  >
                    <XIcon className="size-3.5" />
                  </Button>
                }
              />
              <TooltipPopup side="top">Dismiss until next launch</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
