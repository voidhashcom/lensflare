import {
  type CreateProjectInput,
  type Dataset,
  DEFAULT_PROJECT_ICON,
  type Project,
  type ProjectChangeEvent,
  type ProjectEntity,
  ProjectNotFound,
  type UpdateProjectInput,
  ValidationError,
} from "@lensflare/contracts";
import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { SqlError } from "effect/unstable/sql";
import { makeUniqueSlug, slugify } from "../domain/slug.ts";
import type { DuckDbError } from "../ingest/telemetryStore.ts";
import { datasetFromRow, DatasetsRepository } from "../repositories/datasetsRepository.ts";
import {
  type ProjectRow,
  ProjectsRepository,
  projectEntityFromRow,
} from "../repositories/projectsRepository.ts";
import { DatasetService } from "./datasetService.ts";
import {
  normalizeOptionalName,
  normalizeOptionalSlug,
  normalizeRequiredName,
} from "./validation.ts";

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
    ) => Effect.Effect<void, ProjectNotFound | SqlError.SqlError | DuckDbError>;
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

      const ensureProjectSlug = Effect.fn("ProjectService.ensureProjectSlug")(function* (
        slug: string,
        currentProjectId?: string,
      ) {
        const [existingProject, existingDataset] = yield* Effect.all([
          projects.findBySlug(slug),
          datasets.findBySlug(slug),
        ]);
        if (existingProject !== undefined && existingProject.id !== currentProjectId) {
          return yield* new ValidationError({
            field: "projectSlug",
            message: "Slug is already in use.",
          });
        }
        if (existingDataset !== undefined && existingDataset.project_id !== currentProjectId) {
          return yield* new ValidationError({
            field: "projectSlug",
            message: "Slug is already in use.",
          });
        }

        return slug;
      });

      const resolveProjectSlug = Effect.fn("ProjectService.resolveProjectSlug")(function* (
        name: string,
        explicitSlug: string | undefined,
        currentProjectId?: string,
      ) {
        const normalizedExplicit = yield* normalizeOptionalSlug("projectSlug", explicitSlug);
        if (normalizedExplicit !== undefined) {
          return yield* ensureProjectSlug(normalizedExplicit, currentProjectId);
        }

        const [existingProjects, existingDatasets] = yield* Effect.all([
          projects.findAll(),
          datasets.findAll(),
        ]);
        const usedSlugs = new Set(
          [
            ...existingProjects
              .filter((row) => row.id !== currentProjectId)
              .map((row) => row.slug),
            ...existingDatasets
              .filter((row) => row.project_id !== currentProjectId)
              .map((row) => row.slug),
          ],
        );
        return makeUniqueSlug(slugify(name), usedSlugs);
      });

      const createProject = Effect.fn("ProjectService.createProject")(function* (
        input: CreateProjectInput,
      ) {
        const name = yield* normalizeRequiredName("projectName", input.name);
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const slug = yield* resolveProjectSlug(name, input.slug);
        const icon = input.icon ?? DEFAULT_PROJECT_ICON;

        yield* projects.insert({
          id,
          name,
          slug,
          icon,
          createdAt: now,
          updatedAt: now,
        });
        const dataset = yield* datasetService
          .ensureProjectDataset(id, name, slug, now)
          .pipe(Effect.catchTag("ProjectNotFound", Effect.die));

        const project: Project = {
          id,
          name,
          slug,
          icon,
          createdAt: now,
          updatedAt: now,
          datasets: [dataset],
        };

        yield* publish({
          action: "upsert",
          value: {
            id: project.id,
            name: project.name,
            slug: project.slug,
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
        const nextSlug =
          input.slug === undefined
            ? current.slug
            : yield* resolveProjectSlug(nextName, input.slug, projectId);
        const nextIcon = input.icon ?? current.icon;
        const now = new Date().toISOString();

        yield* projects.update(projectId, {
          name: nextName,
          slug: nextSlug,
          icon: nextIcon,
          updatedAt: now,
        });

        const updatedProjectRow = {
          ...current,
          name: nextName,
          slug: nextSlug,
          icon: nextIcon,
          updated_at: now,
        };
        const updatedDatasets = yield* datasetService
          .syncProjectDataset(projectId, nextName, nextSlug, now)
          .pipe(Effect.catchTag("ProjectNotFound", Effect.die));
        const updated = projectFromRow(updatedProjectRow, updatedDatasets);

        yield* publish({
          action: "upsert",
          value: {
            id: updated.id,
            name: updated.name,
            slug: updated.slug,
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
