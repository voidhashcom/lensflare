import { Outlet, createRootRoute } from "@tanstack/react-router";

import { AppSidebar } from "~/components/AppSidebar";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "~/components/ui/sidebar";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <SidebarProvider defaultOpen>
      <Sidebar
        className="border-r border-border text-foreground"
        collapsible="offcanvas"
        side="left"
      >
        <AppSidebar />
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
