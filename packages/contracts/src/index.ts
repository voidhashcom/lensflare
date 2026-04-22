import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

const AppModeSchema = Schema.Literals(["desktop", "server"]);

export type AppMode = Schema.Schema.Type<typeof AppModeSchema>;

const StaticAssetModeSchema = Schema.Literals([
  "embedded",
  "filesystem",
  "proxy",
  "none",
]);

const ServerSnapshotSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  mode: AppModeSchema,
  platform: Schema.String,
  hostname: Schema.String,
  port: Schema.Number,
  origin: Schema.String,
  startedAt: Schema.String,
  uptimeMs: Schema.Number,
  staticAssetMode: StaticAssetModeSchema,
});

export type ServerSnapshot = Schema.Schema.Type<typeof ServerSnapshotSchema>;

const ServerEventSchema = Schema.Struct({
  type: Schema.Literals(["server.ready", "server.heartbeat"]),
  sentAt: Schema.String,
  snapshot: ServerSnapshotSchema,
  detail: Schema.String,
});

export type ServerEvent = Schema.Schema.Type<typeof ServerEventSchema>;

const decodeServerSnapshotSchema = Schema.decodeUnknownSync(ServerSnapshotSchema);
const decodeServerEventSchema = Schema.decodeUnknownSync(ServerEventSchema);

export function decodeServerSnapshot(input: unknown): ServerSnapshot {
  return decodeServerSnapshotSchema(input);
}

export function decodeServerEvent(input: unknown): ServerEvent {
  return decodeServerEventSchema(input);
}

export const PROJECT_ICONS = ["folder", "sparkles", "rocket", "compass"] as const;
export const DEFAULT_PROJECT_ICON = "folder";

export const ProjectIconSchema = Schema.Literals(PROJECT_ICONS);

export type ProjectIcon = Schema.Schema.Type<typeof ProjectIconSchema>;

export const ProjectEntitySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: ProjectIconSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type ProjectEntity = Schema.Schema.Type<typeof ProjectEntitySchema>;

export const DatasetSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type Dataset = Schema.Schema.Type<typeof DatasetSchema>;

export const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: ProjectIconSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  datasets: Schema.Array(DatasetSchema),
});

export type Project = Schema.Schema.Type<typeof ProjectSchema>;

export const CreateProjectInputSchema = Schema.Struct({
  name: Schema.String,
  icon: Schema.optional(ProjectIconSchema),
});

export type CreateProjectInput = Schema.Schema.Type<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIconSchema),
});

export type UpdateProjectInput = Schema.Schema.Type<typeof UpdateProjectInputSchema>;

export const CreateDatasetInputSchema = Schema.Struct({
  name: Schema.String,
});

export type CreateDatasetInput = Schema.Schema.Type<typeof CreateDatasetInputSchema>;

export const UpdateDatasetInputSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
});

export type UpdateDatasetInput = Schema.Schema.Type<typeof UpdateDatasetInputSchema>;

export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()("ProjectNotFound", {
  projectId: Schema.String,
}) {}

export class DatasetNotFound extends Schema.TaggedErrorClass<DatasetNotFound>()("DatasetNotFound", {
  datasetId: Schema.String,
  projectId: Schema.String,
}) {}

export class ValidationError extends Schema.TaggedErrorClass<ValidationError>()("ValidationError", {
  field: Schema.String,
  message: Schema.String,
}) {}

export const ProjectChangeEventSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("upsert"),
    value: ProjectEntitySchema,
  }),
  Schema.Struct({
    action: Schema.Literal("delete"),
    id: Schema.String,
  }),
]);

export type ProjectChangeEvent = Schema.Schema.Type<typeof ProjectChangeEventSchema>;

export const DatasetChangeEventSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("upsert"),
    value: DatasetSchema,
  }),
  Schema.Struct({
    action: Schema.Literal("delete"),
    id: Schema.String,
  }),
]);

export type DatasetChangeEvent = Schema.Schema.Type<typeof DatasetChangeEventSchema>;

const decodeProjectEntitySchema = Schema.decodeUnknownSync(ProjectEntitySchema);
const decodeProjectSchema = Schema.decodeUnknownSync(ProjectSchema);
const decodeDatasetSchema = Schema.decodeUnknownSync(DatasetSchema);
const decodeCreateProjectInputSchema = Schema.decodeUnknownSync(CreateProjectInputSchema);
const decodeUpdateProjectInputSchema = Schema.decodeUnknownSync(UpdateProjectInputSchema);
const decodeCreateDatasetInputSchema = Schema.decodeUnknownSync(CreateDatasetInputSchema);
const decodeUpdateDatasetInputSchema = Schema.decodeUnknownSync(UpdateDatasetInputSchema);
const decodeProjectChangeEventSchema = Schema.decodeUnknownSync(ProjectChangeEventSchema);
const decodeDatasetChangeEventSchema = Schema.decodeUnknownSync(DatasetChangeEventSchema);

export function decodeProjectEntity(input: unknown): ProjectEntity {
  return decodeProjectEntitySchema(input);
}

export function decodeProject(input: unknown): Project {
  return decodeProjectSchema(input);
}

export function decodeDataset(input: unknown): Dataset {
  return decodeDatasetSchema(input);
}

export function decodeCreateProjectInput(input: unknown): CreateProjectInput {
  return decodeCreateProjectInputSchema(input);
}

export function decodeUpdateProjectInput(input: unknown): UpdateProjectInput {
  return decodeUpdateProjectInputSchema(input);
}

export function decodeCreateDatasetInput(input: unknown): CreateDatasetInput {
  return decodeCreateDatasetInputSchema(input);
}

export function decodeUpdateDatasetInput(input: unknown): UpdateDatasetInput {
  return decodeUpdateDatasetInputSchema(input);
}

export function decodeProjectChangeEvent(input: unknown): ProjectChangeEvent {
  return decodeProjectChangeEventSchema(input);
}

export function decodeDatasetChangeEvent(input: unknown): DatasetChangeEvent {
  return decodeDatasetChangeEventSchema(input);
}

class ListProjectEntities extends Rpc.make("ListProjectEntities", {
  success: Schema.Array(ProjectEntitySchema),
}) {}

class ListProjects extends Rpc.make("ListProjects", {
  success: Schema.Array(ProjectSchema),
}) {}

class GetProject extends Rpc.make("GetProject", {
  payload: {
    projectId: Schema.String,
  },
  success: ProjectSchema,
  error: ProjectNotFound,
}) {}

class CreateProject extends Rpc.make("CreateProject", {
  payload: CreateProjectInputSchema,
  success: ProjectSchema,
  error: ValidationError,
}) {}

class UpdateProject extends Rpc.make("UpdateProject", {
  payload: {
    projectId: Schema.String,
    input: UpdateProjectInputSchema,
  },
  success: ProjectSchema,
  error: Schema.Union([ProjectNotFound, ValidationError]),
}) {}

class DeleteProject extends Rpc.make("DeleteProject", {
  payload: {
    projectId: Schema.String,
  },
  error: ProjectNotFound,
}) {}

class SubscribeProjectEvents extends Rpc.make("SubscribeProjectEvents", {
  success: ProjectChangeEventSchema,
  stream: true,
}) {}

export const ProjectRpcGroup = RpcGroup.make(
  ListProjectEntities,
  ListProjects,
  GetProject,
  CreateProject,
  UpdateProject,
  DeleteProject,
  SubscribeProjectEvents,
);

class ListDatasets extends Rpc.make("ListDatasets", {
  success: Schema.Array(DatasetSchema),
}) {}

class GetDataset extends Rpc.make("GetDataset", {
  payload: {
    projectId: Schema.String,
    datasetId: Schema.String,
  },
  success: DatasetSchema,
  error: DatasetNotFound,
}) {}

class CreateDataset extends Rpc.make("CreateDataset", {
  payload: {
    projectId: Schema.String,
    input: CreateDatasetInputSchema,
  },
  success: DatasetSchema,
  error: Schema.Union([ProjectNotFound, ValidationError]),
}) {}

class UpdateDataset extends Rpc.make("UpdateDataset", {
  payload: {
    projectId: Schema.String,
    datasetId: Schema.String,
    input: UpdateDatasetInputSchema,
  },
  success: DatasetSchema,
  error: Schema.Union([DatasetNotFound, ValidationError]),
}) {}

class DeleteDataset extends Rpc.make("DeleteDataset", {
  payload: {
    projectId: Schema.String,
    datasetId: Schema.String,
  },
  error: DatasetNotFound,
}) {}

class SubscribeDatasetEvents extends Rpc.make("SubscribeDatasetEvents", {
  success: DatasetChangeEventSchema,
  stream: true,
}) {}

export const DatasetRpcGroup = RpcGroup.make(
  ListDatasets,
  GetDataset,
  CreateDataset,
  UpdateDataset,
  DeleteDataset,
  SubscribeDatasetEvents,
);

export function formatProjectError(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.message;
  }

  if (error instanceof ProjectNotFound) {
    return "Project not found.";
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Request failed.";
}

export function formatDatasetError(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.message;
  }

  if (error instanceof ProjectNotFound) {
    return "Project not found.";
  }

  if (error instanceof DatasetNotFound) {
    return "Dataset not found.";
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return "Request failed.";
}
