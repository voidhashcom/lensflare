import { Context, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import {
  ProjectDatasetMismatch,
  UnknownDatasetSlug,
  UnknownProjectSlug,
} from "./errors.ts";

export interface IngestTarget {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly datasetId: string;
  readonly datasetSlug: string;
}

export class IngestTargetResolver extends Context.Service<
  IngestTargetResolver,
  {
    readonly resolve: (
      projectSlug: string,
      datasetSlug: string,
    ) => Effect.Effect<
      IngestTarget,
      UnknownProjectSlug | UnknownDatasetSlug | ProjectDatasetMismatch | SqlError.SqlError
    >;
  }
>()("@lensflare/local-server/IngestTargetResolver") {
  static readonly layer = Layer.effect(
    IngestTargetResolver,
    Effect.gen(function* () {
      const projects = yield* ProjectsRepository;
      const datasets = yield* DatasetsRepository;

      const resolve = Effect.fn("IngestTargetResolver.resolve")(function* (
        projectSlug: string,
        datasetSlug: string,
      ) {
        const project = yield* projects.findBySlug(projectSlug);
        if (project === undefined) {
          return yield* new UnknownProjectSlug({ projectSlug });
        }

        const dataset = yield* datasets.findBySlug(datasetSlug);
        if (dataset === undefined) {
          return yield* new UnknownDatasetSlug({ datasetSlug });
        }

        if (dataset.project_id !== project.id) {
          return yield* new ProjectDatasetMismatch({ projectSlug, datasetSlug });
        }

        return {
          projectId: project.id,
          projectSlug: project.slug,
          datasetId: dataset.id,
          datasetSlug: dataset.slug,
        } satisfies IngestTarget;
      });

      return IngestTargetResolver.of({ resolve });
    }),
  );
}
