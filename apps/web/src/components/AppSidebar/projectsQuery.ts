import { eq, toArray } from "@tanstack/db";

import { datasetsCollection } from "~/collections/datasetsCollection";
import { projectsCollection } from "~/collections/projectsCollection";

export function selectSidebarProjects(q: any) {
  return q
    .from({ project: projectsCollection })
    .orderBy(({ project }: any) => project.updatedAt, "desc")
    .orderBy(({ project }: any) => project.name)
    .select(({ project }: any) => ({
      createdAt: project.createdAt,
      datasets: toArray(
        q
          .from({ dataset: datasetsCollection })
          .where(({ dataset }: any) => eq(dataset.projectId, project.id))
          .orderBy(({ dataset }: any) => dataset.updatedAt, "desc")
          .orderBy(({ dataset }: any) => dataset.name)
          .select(({ dataset }: any) => ({
            createdAt: dataset.createdAt,
            id: dataset.id,
            name: dataset.name,
            projectId: dataset.projectId,
            updatedAt: dataset.updatedAt,
          })),
      ),
      icon: project.icon,
      id: project.id,
      name: project.name,
      updatedAt: project.updatedAt,
    }));
}
