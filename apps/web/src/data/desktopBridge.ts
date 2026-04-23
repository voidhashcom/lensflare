export interface LensflareDesktopBridge {
  readonly restartLocalServer: () => Promise<void>;
}

declare global {
  interface Window {
    lensflareDesktop?: LensflareDesktopBridge;
  }
}

export async function restartDesktopLocalServer(): Promise<boolean> {
  const bridge = window.lensflareDesktop;

  if (!bridge) {
    return false;
  }

  await bridge.restartLocalServer();
  return true;
}
