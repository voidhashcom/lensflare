import { Context, Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import { DatasetsRepository } from "../repositories/datasetsRepository.ts";
import { ProjectsRepository } from "../repositories/projectsRepository.ts";
import { UnknownDatasetSlug } from "./errors.ts";

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
      datasetSlug: string,
    ) => Effect.Effect<IngestTarget, UnknownDatasetSlug | SqlError.SqlError>;
  }
>()("@lensflare/local-server/IngestTargetResolver") {
  static readonly layer = Layer.effect(
    IngestTargetResolver,
    Effect.gen(function* () {
      const projects = yield* ProjectsRepository;
      const datasets = yield* DatasetsRepository;

      const resolve = Effect.fn("IngestTargetResolver.resolve")(function* (datasetSlug: string) {
        const dataset = yield* datasets.findBySlug(datasetSlug);
        if (dataset === undefined) {
          return yield* new UnknownDatasetSlug({ datasetSlug });
        }

        const project = yield* projects.findById(dataset.project_id);
        if (project === undefined) {
          return yield* Effect.die(
            new Error(
              `Dataset "${dataset.id}" references missing project "${dataset.project_id}".`,
            ),
          );
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
