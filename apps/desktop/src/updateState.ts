import type { DesktopUpdateState } from "@lensflare/contracts";

export function shouldBroadcastDownloadProgress(
  currentState: DesktopUpdateState,
  nextPercent: number,
): boolean {
  if (currentState.status !== "downloading") {
    return true;
  }

  const currentPercent = currentState.downloadPercent;
  if (currentPercent === null) {
    return true;
  }

  const previousStep = Math.floor(currentPercent / 10);
  const nextStep = Math.floor(nextPercent / 10);
  return nextStep !== previousStep || nextPercent === 100 || nextPercent < currentPercent;
}

export function nextStatusAfterDownloadFailure(
  currentState: DesktopUpdateState,
): DesktopUpdateState["status"] {
  return currentState.availableVersion ? "available" : "error";
}

export function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState): boolean {
  return currentState.availableVersion !== null;
}

export function getAutoUpdateDisabledReason(args: {
  readonly isDevelopment: boolean;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
  readonly appImage?: string | undefined;
  readonly disabledByEnv: boolean;
  readonly hasUpdateFeedConfig: boolean;
}): string | null {
  if (args.disabledByEnv) {
    return "Automatic updates are disabled by the LENSFLARE_DISABLE_AUTO_UPDATE setting.";
  }
  if (args.isDevelopment || !args.isPackaged) {
    return "Automatic updates are only available in packaged production builds.";
  }
  if (args.platform === "linux" && !args.appImage) {
    return "Automatic updates on Linux require running the AppImage build.";
  }
  if (!args.hasUpdateFeedConfig) {
    return "Automatic updates are not available because no update feed is configured.";
  }
  return null;
}
