import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export function createAppRouter(): AppRouter {
  return createRouter({
    defaultPreload: "intent",
    routeTree,
  });
}

export type AppRouter = ReturnType<typeof createRouter<typeof routeTree>>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
