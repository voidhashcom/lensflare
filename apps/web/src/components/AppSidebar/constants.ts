import type { ProjectIcon } from "@lensflare/contracts";
import { CompassIcon, FolderIcon, RocketIcon, SparklesIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

export const ROUTE_PARAMS_OPTIONS = { strict: false } as const;

/** Maps a project icon identifier to its lucide icon component. */
export const PROJECT_ICON_COMPONENTS: Record<ProjectIcon, ComponentType<SVGProps<SVGSVGElement>>> = {
  compass: CompassIcon,
  folder: FolderIcon,
  rocket: RocketIcon,
  sparkles: SparklesIcon,
};

/** Small helper to keep icon lookup typed where the map is consumed. */
export function getProjectIconComponent(icon: ProjectIcon) {
  return PROJECT_ICON_COMPONENTS[icon];
}
