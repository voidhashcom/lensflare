/// <reference types="vite-plus/client" />

import type { DesktopBridge } from "@lensflare/contracts";

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
    lensflareDesktop?: DesktopBridge;
  }
}
