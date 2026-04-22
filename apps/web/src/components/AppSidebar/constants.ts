import type { ProjectIcon } from "@lensflare/contracts";
import { CompassIcon, FolderIcon, RocketIcon, SparklesIcon } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

/** Maps a project icon identifier to its lucide icon component. */
export const PROJECT_ICON_COMPONENTS: Record<ProjectIcon, ComponentType<SVGProps<SVGSVGElement>>> = {
  compass: CompassIcon,
  folder: FolderIcon,
  rocket: RocketIcon,
  sparkles: SparklesIcon,
};
