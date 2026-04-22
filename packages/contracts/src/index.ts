import * as Schema from "effect/Schema";

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

const decodeProjectSchema = Schema.decodeUnknownSync(ProjectSchema);
const decodeDatasetSchema = Schema.decodeUnknownSync(DatasetSchema);
const decodeCreateProjectInputSchema = Schema.decodeUnknownSync(CreateProjectInputSchema);
const decodeUpdateProjectInputSchema = Schema.decodeUnknownSync(UpdateProjectInputSchema);
const decodeCreateDatasetInputSchema = Schema.decodeUnknownSync(CreateDatasetInputSchema);
const decodeUpdateDatasetInputSchema = Schema.decodeUnknownSync(UpdateDatasetInputSchema);

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
