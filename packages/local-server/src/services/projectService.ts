import {
  type CreateProjectInput,
  type Dataset,
  DEFAULT_PROJECT_ICON,
  type Project,
  type ProjectChangeEvent,
  type ProjectEntity,
  ProjectNotFound,
  type UpdateProjectInput,
  type ValidationError,
} from "@lensflare/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { SqlError } from "effect/unstable/sql";
import { datasetFromRow, DatasetsRepository } from "../repositories/datasetsRepository.ts";
import {
  type ProjectRow,
  ProjectsRepository,
  projectEntityFromRow,
} from "../repositories/projectsRepository.ts";
import { DatasetService } from "./datasetService.ts";
import { normalizeOptionalName, normalizeRequiredName } from "./validation.ts";

function projectFromRow(row: ProjectRow, datasets: ReadonlyArray<Dataset>): Project {
  return {
    ...projectEntityFromRow(row),
    datasets,
  };
}

/**
 * Domain-level façade over the projects repository.
 *
 * Responsibilities that belong here (and intentionally NOT in the
 * repository):
 *   - input validation ({@link ValidationError}) and not-found checks
 *     ({@link ProjectNotFound})
 *   - generating identifiers and timestamps for new rows
 *   - aggregating projects + their datasets into the {@link Project} shape
 *     (uses {@link DatasetsRepository} directly for the group-by query so
 *     we avoid N+1 reads and don't incur dataset-event side effects while
 *     only reading)
 *   - owning the project change stream consumed by RPC subscribers,
 *     while keeping event publication private to the service
 *
 * Dataset change events emitted by a project cascade delete are delegated
 * to {@link DatasetService.notifyCascadeDeletedDatasets} so each service
 * owns publishing to its own change stream. `SqlError` is left in the error
 * channel: the RPC layer is the single place that decides how to surface
 * infrastructure failures to clients.
 */
export class ProjectService extends Context.Service<
  ProjectService,
  {
    readonly listProjectEntities: () => Effect.Effect<
      ReadonlyArray<ProjectEntity>,
      SqlError.SqlError
    >;
    readonly listProjects: () => Effect.Effect<ReadonlyArray<Project>, SqlError.SqlError>;
    readonly getProject: (
      projectId: string,
    ) => Effect.Effect<Project, ProjectNotFound | SqlError.SqlError>;
    readonly createProject: (
      input: CreateProjectInput,
    ) => Effect.Effect<Project, ValidationError | SqlError.SqlError>;
    readonly updateProject: (
      projectId: string,
      input: UpdateProjectInput,
    ) => Effect.Effect<Project, ProjectNotFound | ValidationError | SqlError.SqlError>;
    readonly deleteProject: (
      projectId: string,
    ) => Effect.Effect<void, ProjectNotFound | SqlError.SqlError>;
    readonly stream: Stream.Stream<ProjectChangeEvent>;
  }
>()("@lensflare/local-server/ProjectService") {
  static readonly layer = Layer.effect(
    ProjectService,
    Effect.gen(function* () {
      const projects = yield* ProjectsRepository;
      const datasets = yield* DatasetsRepository;
      const datasetService = yield* DatasetService;
      const pubsub = yield* PubSub.unbounded<ProjectChangeEvent>();
      const stream = Stream.fromPubSub(pubsub);

      const publish = Effect.fn("ProjectService.publish")(function* (event: ProjectChangeEvent) {
        yield* PubSub.publish(pubsub, event);
      });

      const requireProjectRow = Effect.fn("ProjectService.requireProjectRow")(function* (
        projectId: string,
      ) {
        const row = yield* projects.findById(projectId);
        if (row === undefined) {
          return yield* new ProjectNotFound({ projectId });
        }
        return row;
      });

      const assembleProject = Effect.fn("ProjectService.assembleProject")(function* (
        row: ProjectRow,
      ) {
        const datasetRows = yield* datasets.findAll(row.id);
        return projectFromRow(
          row,
          datasetRows.map((d) => datasetFromRow(d)),
        );
      });

      const listProjectEntities = Effect.fn("ProjectService.listProjectEntities")(function* () {
        const rows = yield* projects.findAll();
        return rows.map((row) => projectEntityFromRow(row));
      });

      const listProjects = Effect.fn("ProjectService.listProjects")(function* () {
        const [projectRows, datasetRows] = yield* Effect.all([
          projects.findAll(),
          datasets.findAll(),
        ]);

        // Group datasets by project once instead of issuing N+1 queries.
        const datasetsByProjectId = new Map<string, Array<Dataset>>();
        for (const row of datasetRows) {
          const list = datasetsByProjectId.get(row.project_id) ?? [];
          list.push(datasetFromRow(row));
          datasetsByProjectId.set(row.project_id, list);
        }

        return projectRows.map((row) => projectFromRow(row, datasetsByProjectId.get(row.id) ?? []));
      });

      const getProject = Effect.fn("ProjectService.getProject")(function* (projectId: string) {
        const row = yield* requireProjectRow(projectId);
        return yield* assembleProject(row);
      });

      const createProject = Effect.fn("ProjectService.createProject")(function* (
        input: CreateProjectInput,
      ) {
        const name = yield* normalizeRequiredName("projectName", input.name);
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const icon = input.icon ?? DEFAULT_PROJECT_ICON;

        yield* projects.insert({
          id,
          name,
          icon,
          createdAt: now,
          updatedAt: now,
        });

        const project: Project = {
          id,
          name,
          icon,
          createdAt: now,
          updatedAt: now,
          datasets: [],
        };

        yield* publish({
          action: "upsert",
          value: {
            id: project.id,
            name: project.name,
            icon: project.icon,
            createdAt: project.createdAt,
            updatedAt: project.updatedAt,
          },
        });

        return project;
      });

      const updateProject = Effect.fn("ProjectService.updateProject")(function* (
        projectId: string,
        input: UpdateProjectInput,
      ) {
        const current = yield* requireProjectRow(projectId);
        const trimmed = yield* normalizeOptionalName("projectName", input.name);
        const nextName = trimmed ?? current.name;
        const nextIcon = input.icon ?? current.icon;
        const now = new Date().toISOString();

        yield* projects.update(projectId, {
          name: nextName,
          icon: nextIcon,
          updatedAt: now,
        });

        const updated = yield* assembleProject({
          ...current,
          name: nextName,
          icon: nextIcon,
          updated_at: now,
        });

        yield* publish({
          action: "upsert",
          value: {
            id: updated.id,
            name: updated.name,
            icon: updated.icon,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
        });

        return updated;
      });

      const deleteProject = Effect.fn("ProjectService.deleteProject")(function* (
        projectId: string,
      ) {
        // Capture dataset IDs before the SQL FK cascade removes the rows so
        // we can fan out dataset delete events with the right IDs after the
        // row is gone. Emitting those events is delegated to DatasetService
        // so ownership of dataset event publication stays in one place.
        const project = yield* getProject(projectId);

        yield* projects.remove(projectId);

        yield* datasetService.notifyCascadeDeletedDatasets(
          project.datasets.map((dataset) => dataset.id),
        );

        yield* publish({
          action: "delete",
          id: projectId,
        });
      });

      return ProjectService.of({
        listProjectEntities,
        listProjects,
        getProject,
        createProject,
        updateProject,
        deleteProject,
        stream,
      });
    }),
  );
}
