import { ProjectRpcGroup } from "@lensflare/contracts";
import { Effect } from "effect";
import { ProjectService } from "../services/projectService.ts";

/**
 * RPC handlers for the project group.
 *
 * Each handler is a thin pass-through to {@link ProjectService}, with one
 * cross-cutting concern: turning {@link SqlError} into a defect via
 * {@link Effect.die}. The contract schemas only declare typed errors
 * (`ProjectNotFound`, `ValidationError`), so SQL/IO failures must NOT
 * escape onto the wire — letting them die surfaces them as a 500-style
 * fault on the client and keeps the success/error union exact.
 *
 * The event subscription handler is wired to read directly from
 * {@link ProjectService.stream}.
 */
export const projectRpcLayer = ProjectRpcGroup.toLayer(
  Effect.gen(function* () {
    const service = yield* ProjectService;

    return ProjectRpcGroup.of({
      ListProjectEntities: () =>
        service.listProjectEntities().pipe(Effect.catchTag("SqlError", Effect.die)),
      ListProjects: () => service.listProjects().pipe(Effect.catchTag("SqlError", Effect.die)),
      GetProject: ({ projectId }) =>
        service.getProject(projectId).pipe(Effect.catchTag("SqlError", Effect.die)),
      CreateProject: (input) =>
        service.createProject(input).pipe(Effect.catchTag("SqlError", Effect.die)),
      UpdateProject: ({ projectId, input }) =>
        service.updateProject(projectId, input).pipe(Effect.catchTag("SqlError", Effect.die)),
      DeleteProject: ({ projectId }) =>
        service.deleteProject(projectId).pipe(Effect.catchTag("SqlError", Effect.die)),
      SubscribeProjectEvents: () => service.stream,
    });
  }),
);
