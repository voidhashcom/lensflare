export const BRAND_ASSET_PATHS = {
  productionMacIconIcns: "assets/prod/lightflare-macos.icns",
  productionLinuxIconPng: "assets/prod/lightflare-linux-512.png",
  productionWindowsIconIco: "assets/prod/lightflare-windows.ico",
  productionWebFaviconIco: "assets/prod/lightflare-web-favicon.ico",
  productionWebFavicon16Png: "assets/prod/lightflare-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/prod/lightflare-web-favicon-32x32.png",
  productionWebAppleTouchIconPng: "assets/prod/lightflare-web-apple-touch.png",

  nightlyMacIconIcns: "assets/nightly/lightflare-macos.icns",
  nightlyLinuxIconPng: "assets/nightly/lightflare-linux-512.png",
  nightlyWindowsIconIco: "assets/nightly/lightflare-windows.ico",
  nightlyWebFaviconIco: "assets/nightly/lightflare-web-favicon.ico",
  nightlyWebFavicon16Png: "assets/nightly/lightflare-web-favicon-16x16.png",
  nightlyWebFavicon32Png: "assets/nightly/lightflare-web-favicon-32x32.png",
  nightlyWebAppleTouchIconPng: "assets/nightly/lightflare-web-apple-touch.png",

  developmentMacIconIcns: "assets/dev/lightflare-macos.icns",
  developmentMacIconPng: "assets/dev/lightflare-macos-1024.png",
  developmentLinuxIconPng: "assets/dev/lightflare-linux-512.png",
  developmentWindowsIconIco: "assets/dev/lightflare-windows.ico",
} as const;

export interface DesktopBuildIconAssets {
  readonly macIconIcns: string;
  readonly linuxIconPng: string;
  readonly windowsIconIco: string;
  readonly webFaviconIco: string;
  readonly webFavicon16Png: string;
  readonly webFavicon32Png: string;
  readonly webAppleTouchIconPng: string;
}
