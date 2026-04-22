import { Collapsible } from "@base-ui/react/collapsible";
import { Link, useParams } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CompassIcon,
  FolderIcon,
  PlusIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";
import * as React from "react";

import { Logo } from "~/components/Logo";
import { Kbd } from "~/components/ui/kbd";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "~/components/ui/sidebar";
import type { MockProject } from "~/data/mockProjects";
import { mockProjects } from "~/data/mockProjects";
import { cn } from "~/lib/utils";

const PROJECT_ICONS = {
  folder: FolderIcon,
  sparkles: SparklesIcon,
  rocket: RocketIcon,
  compass: CompassIcon,
} as const;

export function AppSidebar() {
  const isMacDesktop =
    typeof document !== "undefined" &&
    document.documentElement.dataset.runtime === "electron" &&
    document.documentElement.dataset.platform === "macos";

  return (
    <>
      <SidebarHeader
        className={cn(
          "gap-3 px-3 pb-2 sm:gap-2.5 sm:px-4 sm:pb-3",
          isMacDesktop ? "desktop-drag pt-0" : "pt-2 sm:pt-3",
        )}
      >
        <BrandRow isMacDesktop={isMacDesktop} />
        <SearchRow />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
            <span className="font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
              Projects
            </span>
            <button
              aria-label="New project"
              className="desktop-no-drag inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              title="New project"
              type="button"
            >
              <PlusIcon className="size-3.5" />
            </button>
          </div>

          <SidebarMenu>
            {mockProjects.map((project) => (
              <ProjectRow key={project.id} project={project} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
              size="sm"
            >
              <SettingsIcon className="size-3.5" />
              <span className="text-xs">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}

function BrandRow({ isMacDesktop }: { isMacDesktop: boolean }) {
  return (
    <div
      className={cn(
        "grid items-center",
        isMacDesktop
          ? "-ml-3 h-[var(--desktop-titlebar-height)] grid-cols-[var(--desktop-traffic-light-clearance)_minmax(0,1fr)] sm:-ml-4"
          : "grid-cols-[1fr]",
        !isMacDesktop && "min-h-8",
      )}
    >
      {isMacDesktop ? <div aria-hidden className="h-full" /> : null}
      <Logo
        aria-label="Lensflare"
        className={cn(
          "h-4.5 mt-1 w-auto max-w-[11.5rem] text-sidebar-foreground",
          isMacDesktop ? "justify-self-center" : "justify-self-center",
        )}
      />
    </div>
  );
}

function SearchRow() {
  return (
    <div className="desktop-no-drag relative flex h-8 items-center rounded-lg bg-accent/40 pl-2.5 pr-2 ring-ring/24 transition-shadow has-focus-visible:ring-[3px]">
      <SearchIcon className="pointer-events-none size-3.5 shrink-0 text-muted-foreground" />
      <input
        aria-label="Search projects and collections"
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm leading-8 outline-none placeholder:text-muted-foreground/72"
        placeholder="Search"
        type="search"
      />
      <Kbd>⌘K</Kbd>
    </div>
  );
}

function ProjectRow({ project }: { project: MockProject }) {
  const params = useParams({ strict: false });
  const activeProjectId = params.projectId;
  const activeCollectionId = params.collectionId;

  const Icon = PROJECT_ICONS[project.icon];
  const [open, setOpen] = React.useState(true);

  return (
    <SidebarMenuItem>
      <Collapsible.Root onOpenChange={setOpen} open={open}>
        {/* Scope hover to the whole header row so the "+" button feels part
            of the same surface and hovering it also highlights the row. */}
        <div className="group/project-header relative">
          <SidebarMenuButton
            className="gap-2 cursor-pointer px-2 py-1.5 pr-8 text-left group-hover/project-header:bg-accent group-hover/project-header:text-accent-foreground"
            render={<Collapsible.Trigger />}
            size="sm"
          >
            <ChevronRightIcon
              className={cn(
                "-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                open && "rotate-90",
              )}
            />
            <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate font-medium text-foreground/90 text-xs">
                {project.name}
              </span>
            </span>
          </SidebarMenuButton>

          <button
            aria-label={`New collection in ${project.name}`}
            className="desktop-no-drag absolute top-1 right-1.5 inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring group-hover/project-header:opacity-100"
            title="New collection"
            type="button"
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>

        <Collapsible.Panel className="overflow-hidden transition-all data-[ending-style]:h-0 data-[starting-style]:h-0">
          <SidebarMenuSub>
            {project.collections.map((collection) => {
              const isActive =
                activeProjectId === project.id && activeCollectionId === collection.id;
              return (
                <SidebarMenuSubItem key={collection.id}>
                  <SidebarMenuSubButton
                    className="text-muted-foreground hover:text-foreground data-[active=true]:font-medium data-[active=true]:text-foreground"
                    isActive={isActive}
                    render={
                      <Link
                        params={{
                          collectionId: collection.id,
                          projectId: project.id,
                        }}
                        to="/projects/$projectId/collections/$collectionId"
                      />
                    }
                    size="sm"
                  >
                    <span className="truncate">{collection.name}</span>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </Collapsible.Panel>
      </Collapsible.Root>
    </SidebarMenuItem>
  );
}
