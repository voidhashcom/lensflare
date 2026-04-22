import type * as React from "react";

// The implementation lives in TSRX files under ./AppSidebar. The Vite plugin
// (`tsrx-react-plugin.ts`) compiles them at build time. TypeScript doesn't
// natively understand the `.tsrx` extension, so we silence the module-not-found
// error and pin a typed surface for consumers below.
// @ts-expect-error -- TSRX module resolved at build time by the tsrx-react Vite plugin
import { AppSidebar as AppSidebarImpl } from "./AppSidebar/AppSidebar.tsrx";

export const AppSidebar: React.FC = AppSidebarImpl;
