import { formatProjectError, type ProjectEntity } from "@lensflare/contracts";
import { createCollection } from "@tanstack/db";
import { createEntityCollectionOptions } from "./createEntityCollection";

/**
 * TanStack DB collection backed by the project RPC snapshot +
 * {@link SubscribeProjectEvents} stream. Mutations are NOT routed through
 * this collection — they live in `~/data/projectApi` — so this file
 * intentionally only exposes the collection instance and the error
 * formatter it needs for its sync helper.
 */
function toProjectError(error: unknown): Error {
  return new Error(formatProjectError(error));
}

export const projectsCollection = createCollection(
  createEntityCollectionOptions<ProjectEntity, string>({
    getKey: (project) => project.id,
    list: (client) => client.ListProjectEntities(),
    subscribe: (client) => client.SubscribeProjectEvents(),
    formatError: toProjectError,
  }),
);
