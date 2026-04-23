import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

const AppModeSchema = Schema.Literals(["desktop", "server"]);

export type AppMode = Schema.Schema.Type<typeof AppModeSchema>;

const StaticAssetModeSchema = Schema.Literals(["embedded", "filesystem", "proxy", "none"]);

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

/**
 * Public "environment descriptor" served at
 * `/.well-known/lensflare/environment`. The browser uses it to learn the
 * explicit HTTP + WebSocket base URLs of the backend it should talk to, so
 * it never has to infer transport targets from `window.location` or Vite
 * proxy shims. `serverInstanceId` changes on every successful
 * {@link startLocalServer} so clients can detect a fresh process across
 * restarts.
 */
export const LensflareEnvironmentDescriptorSchema = Schema.Struct({
  appName: Schema.String,
  appVersion: Schema.String,
  mode: AppModeSchema,
  platform: Schema.String,
  host: Schema.String,
  port: Schema.Number,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  serverInstanceId: Schema.String,
  startedAt: Schema.String,
});

export type LensflareEnvironmentDescriptor = Schema.Schema.Type<
  typeof LensflareEnvironmentDescriptorSchema
>;

const decodeLensflareEnvironmentDescriptorSchema = Schema.decodeUnknownSync(
  LensflareEnvironmentDescriptorSchema,
);

export function decodeLensflareEnvironmentDescriptor(
  input: unknown,
): LensflareEnvironmentDescriptor {
  return decodeLensflareEnvironmentDescriptorSchema(input);
}

/**
 * Typed payload the desktop shell hands to the renderer as the default
 * backend target. The renderer converts this into {@link BackendTarget} via
 * `~/data/backendTarget`.
 */
export interface DesktopEnvironmentBootstrap {
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly serverInstanceId: string;
}

/**
 * Lifecycle state of the backend process owned by the desktop shell. The
 * renderer mirrors these transitions in its connection UI.
 */
export type DesktopLocalServerState =
  | { readonly status: "starting" }
  | { readonly status: "ready"; readonly bootstrap: DesktopEnvironmentBootstrap }
  | { readonly status: "restarting" }
  | { readonly status: "failed"; readonly message: string };

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

export type DesktopUpdateChannel = "latest" | "nightly";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";

export interface DesktopRuntimeInfo {
  readonly hostArch: DesktopRuntimeArch;
  readonly appArch: DesktopRuntimeArch;
  readonly runningUnderArm64Translation: boolean;
}

export interface DesktopUpdateState {
  readonly enabled: boolean;
  readonly status: DesktopUpdateStatus;
  readonly channel: DesktopUpdateChannel;
  readonly currentVersion: string;
  readonly hostArch: DesktopRuntimeArch;
  readonly appArch: DesktopRuntimeArch;
  readonly runningUnderArm64Translation: boolean;
  readonly availableVersion: string | null;
  readonly downloadedVersion: string | null;
  readonly downloadPercent: number | null;
  readonly checkedAt: string | null;
  readonly message: string | null;
  readonly errorContext: "check" | "download" | "install" | null;
  readonly canRetry: boolean;
}

export interface DesktopUpdateActionResult {
  readonly accepted: boolean;
  readonly completed: boolean;
  readonly state: DesktopUpdateState;
}

export interface DesktopUpdateCheckResult {
  readonly checked: boolean;
  readonly state: DesktopUpdateState;
}

/**
 * Desktop-only bridge. Anything going through this contract lives outside
 * the Effect RPC surface because it needs to run on the main process
 * (process lifecycle, local shell capabilities). Backend calls must not
 * be added here — they belong on the backend target exposed via
 * {@link DesktopEnvironmentBootstrap}.
 */
export interface DesktopBridge {
  readonly getLocalServerState: () => Promise<DesktopLocalServerState>;
  readonly restartLocalServer: () => Promise<DesktopLocalServerState>;
  readonly onLocalServerState: (listener: (state: DesktopLocalServerState) => void) => () => void;
  readonly getLocalServerBootstrap: () => DesktopEnvironmentBootstrap | null;
  readonly getUpdateState: () => Promise<DesktopUpdateState>;
  readonly setUpdateChannel: (channel: DesktopUpdateChannel) => Promise<DesktopUpdateState>;
  readonly checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  readonly downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  readonly installUpdate: () => Promise<DesktopUpdateActionResult>;
  readonly onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

export interface LensflareDesktopBridge extends DesktopBridge {}

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
  slug: Schema.String,
  icon: ProjectIconSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type ProjectEntity = Schema.Schema.Type<typeof ProjectEntitySchema>;

export const DatasetSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type Dataset = Schema.Schema.Type<typeof DatasetSchema>;

export const ProjectSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  icon: ProjectIconSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  datasets: Schema.Array(DatasetSchema),
});

export type Project = Schema.Schema.Type<typeof ProjectSchema>;

export const CreateProjectInputSchema = Schema.Struct({
  name: Schema.String,
  slug: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIconSchema),
});

export type CreateProjectInput = Schema.Schema.Type<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
  icon: Schema.optional(ProjectIconSchema),
});

export type UpdateProjectInput = Schema.Schema.Type<typeof UpdateProjectInputSchema>;

export const CreateDatasetInputSchema = Schema.Struct({
  name: Schema.String,
  slug: Schema.optional(Schema.String),
});

export type CreateDatasetInput = Schema.Schema.Type<typeof CreateDatasetInputSchema>;

export const UpdateDatasetInputSchema = Schema.Struct({
  name: Schema.optional(Schema.String),
  slug: Schema.optional(Schema.String),
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

export const TelemetryLogLevelSchema = Schema.Literals([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

export type TelemetryLogLevel = Schema.Schema.Type<typeof TelemetryLogLevelSchema>;

export const TelemetryLogEntrySchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  sourceName: Schema.String,
  level: TelemetryLogLevelSchema,
  message: Schema.String,
  traceId: Schema.optional(Schema.String),
  spanId: Schema.optional(Schema.String),
});

export type TelemetryLogEntry = Schema.Schema.Type<typeof TelemetryLogEntrySchema>;

export const TelemetryLogEntriesSchema = Schema.Array(TelemetryLogEntrySchema);

export const TelemetryTraceSpanStatusSchema = Schema.Literals(["ok", "error", "unset"]);

export type TelemetryTraceSpanStatus = Schema.Schema.Type<typeof TelemetryTraceSpanStatusSchema>;

export const TelemetryTraceSpanSchema = Schema.Struct({
  id: Schema.String,
  parentSpanId: Schema.NullOr(Schema.String),
  name: Schema.String,
  serviceName: Schema.String,
  startOffsetUs: Schema.Number,
  durationUs: Schema.Number,
  status: TelemetryTraceSpanStatusSchema,
});

export type TelemetryTraceSpan = Schema.Schema.Type<typeof TelemetryTraceSpanSchema>;

export const TelemetryTraceContextSchema = Schema.Struct({
  traceId: Schema.String,
  startTime: Schema.String,
  totalDurationUs: Schema.Number,
  spans: Schema.Array(TelemetryTraceSpanSchema),
  currentSpanId: Schema.String,
});

export type TelemetryTraceContext = Schema.Schema.Type<typeof TelemetryTraceContextSchema>;

export const NullableTelemetryTraceContextSchema = Schema.NullOr(TelemetryTraceContextSchema);

export const TelemetryLogPageInfoSchema = Schema.Struct({
  hasPreviousPage: Schema.Boolean,
  hasNextPage: Schema.Boolean,
  startCursor: Schema.NullOr(Schema.String),
  endCursor: Schema.NullOr(Schema.String),
});

export type TelemetryLogPageInfo = Schema.Schema.Type<typeof TelemetryLogPageInfoSchema>;

export const TelemetryLogPageSchema = Schema.Struct({
  entries: TelemetryLogEntriesSchema,
  pageInfo: TelemetryLogPageInfoSchema,
});

export type TelemetryLogPage = Schema.Schema.Type<typeof TelemetryLogPageSchema>;

const decodeProjectEntitySchema = Schema.decodeUnknownSync(ProjectEntitySchema);
const decodeProjectSchema = Schema.decodeUnknownSync(ProjectSchema);
const decodeDatasetSchema = Schema.decodeUnknownSync(DatasetSchema);
const decodeCreateProjectInputSchema = Schema.decodeUnknownSync(CreateProjectInputSchema);
const decodeUpdateProjectInputSchema = Schema.decodeUnknownSync(UpdateProjectInputSchema);
const decodeCreateDatasetInputSchema = Schema.decodeUnknownSync(CreateDatasetInputSchema);
const decodeUpdateDatasetInputSchema = Schema.decodeUnknownSync(UpdateDatasetInputSchema);
const decodeProjectChangeEventSchema = Schema.decodeUnknownSync(ProjectChangeEventSchema);
const decodeDatasetChangeEventSchema = Schema.decodeUnknownSync(DatasetChangeEventSchema);
const decodeTelemetryLogEntrySchema = Schema.decodeUnknownSync(TelemetryLogEntrySchema);
const decodeTelemetryLogEntriesSchema = Schema.decodeUnknownSync(TelemetryLogEntriesSchema);
const decodeTelemetryLogPageSchema = Schema.decodeUnknownSync(TelemetryLogPageSchema);
const decodeNullableTelemetryTraceContextSchema = Schema.decodeUnknownSync(
  NullableTelemetryTraceContextSchema,
);

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

export function decodeTelemetryLogEntry(input: unknown): TelemetryLogEntry {
  return decodeTelemetryLogEntrySchema(input);
}

export function decodeTelemetryLogEntries(input: unknown): Array<TelemetryLogEntry> {
  return [...decodeTelemetryLogEntriesSchema(input)];
}

export function decodeTelemetryLogPage(input: unknown): TelemetryLogPage {
  return decodeTelemetryLogPageSchema(input);
}

export function decodeTelemetryTraceContext(input: unknown): TelemetryTraceContext | null {
  return decodeNullableTelemetryTraceContextSchema(input);
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

class SubscribeTelemetryLogEvents extends Rpc.make("SubscribeTelemetryLogEvents", {
  payload: {
    projectId: Schema.String,
    datasetId: Schema.String,
  },
  success: TelemetryLogEntrySchema,
  stream: true,
}) {}

export const TelemetryLogRpcGroup = RpcGroup.make(SubscribeTelemetryLogEvents);

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
