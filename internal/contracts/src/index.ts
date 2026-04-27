import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { FilterNodeSchema } from "./filter.ts";

export * from "./filter.ts";

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
export type DesktopTheme = "light" | "dark" | "system";

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
  readonly setTheme: (theme: DesktopTheme) => Promise<void>;
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

export const DatasetStorageStatsSchema = Schema.Struct({
  datasetId: Schema.String,
  bytes: Schema.Number,
});

export type DatasetStorageStats = Schema.Schema.Type<typeof DatasetStorageStatsSchema>;

export const AppSettingsSchema = Schema.Struct({
  analyticsEnabled: Schema.Boolean,
});

export type AppSettings = Schema.Schema.Type<typeof AppSettingsSchema>;

export const UpdateAppSettingsInputSchema = Schema.Struct({
  analyticsEnabled: Schema.optional(Schema.Boolean),
});

export type UpdateAppSettingsInput = Schema.Schema.Type<typeof UpdateAppSettingsInputSchema>;

export const AnalyticsBootstrapSchema = Schema.Struct({
  enabled: Schema.Boolean,
  distinctId: Schema.String,
  host: Schema.String,
  apiKey: Schema.optional(Schema.String),
  debug: Schema.Boolean,
});

export type AnalyticsBootstrap = Schema.Schema.Type<typeof AnalyticsBootstrapSchema>;

export const AppMetaSchema = Schema.Struct({
  appName: Schema.String,
  appVersion: Schema.String,
  serverOrigin: Schema.String,
  mode: AppModeSchema,
  staticAssetMode: StaticAssetModeSchema,
  sqliteDatabaseFile: Schema.String,
  duckdbDatabaseFile: Schema.String,
  analytics: AnalyticsBootstrapSchema,
});

export type AppMeta = Schema.Schema.Type<typeof AppMetaSchema>;

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

/**
 * Wire format for a single log row streamed / paginated to the UI. Widened to
 * carry the fields needed for client-side attribute filtering (severity,
 * service, trace/span ids, arbitrary attributes) so the in-browser evaluator
 * can apply the same AST the server compiled to SQL. `attributes` is a loose
 * record because OTLP attribute keys are open-ended — the evaluator copes with
 * any JSON-serialisable leaf.
 */
export const TelemetryLogEntrySchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  sourceName: Schema.String,
  level: TelemetryLogLevelSchema,
  message: Schema.String,
  severityNumber: Schema.NullOr(Schema.Number),
  severityText: Schema.NullOr(Schema.String),
  serviceName: Schema.NullOr(Schema.String),
  traceId: Schema.NullOr(Schema.String),
  spanId: Schema.NullOr(Schema.String),
  attributes: Schema.Record(Schema.String, Schema.Unknown),
});

export type TelemetryLogEntry = Schema.Schema.Type<typeof TelemetryLogEntrySchema>;

export const TelemetryLogEntriesSchema = Schema.Array(TelemetryLogEntrySchema);

export const TelemetryTraceSpanStatusSchema = Schema.Literals(["ok", "error", "unset"]);

export type TelemetryTraceSpanStatus = Schema.Schema.Type<typeof TelemetryTraceSpanStatusSchema>;

export const TelemetryRecordKindSchema = Schema.Literals(["log", "span", "spanEvent"]);

export type TelemetryRecordKind = Schema.Schema.Type<typeof TelemetryRecordKindSchema>;

export const TelemetrySpanEventSchema = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  name: Schema.String,
  attributes: Schema.Record(Schema.String, Schema.Unknown),
});

export type TelemetrySpanEvent = Schema.Schema.Type<typeof TelemetrySpanEventSchema>;

export const TelemetryLogRecordSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("log"),
  timestamp: Schema.String,
  sourceName: Schema.String,
  level: TelemetryLogLevelSchema,
  message: Schema.String,
  severityNumber: Schema.NullOr(Schema.Number),
  severityText: Schema.NullOr(Schema.String),
  serviceName: Schema.NullOr(Schema.String),
  traceId: Schema.NullOr(Schema.String),
  spanId: Schema.NullOr(Schema.String),
  attributes: Schema.Record(Schema.String, Schema.Unknown),
});

export type TelemetryLogRecord = Schema.Schema.Type<typeof TelemetryLogRecordSchema>;

export const TelemetrySpanRecordSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("span"),
  timestamp: Schema.String,
  sourceName: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.NullOr(Schema.String),
  name: Schema.String,
  serviceName: Schema.NullOr(Schema.String),
  status: TelemetryTraceSpanStatusSchema,
  statusMessage: Schema.NullOr(Schema.String),
  durationUs: Schema.Number,
  attributes: Schema.Record(Schema.String, Schema.Unknown),
  events: Schema.Array(TelemetrySpanEventSchema),
});

export type TelemetrySpanRecord = Schema.Schema.Type<typeof TelemetrySpanRecordSchema>;

export const TelemetrySpanEventRecordSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("spanEvent"),
  timestamp: Schema.String,
  sourceName: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  name: Schema.String,
  serviceName: Schema.NullOr(Schema.String),
  attributes: Schema.Record(Schema.String, Schema.Unknown),
});

export type TelemetrySpanEventRecord = Schema.Schema.Type<typeof TelemetrySpanEventRecordSchema>;

export const TelemetryRecordSchema = Schema.Union([
  TelemetryLogRecordSchema,
  TelemetrySpanRecordSchema,
  TelemetrySpanEventRecordSchema,
]);

export type TelemetryRecord = Schema.Schema.Type<typeof TelemetryRecordSchema>;

export const TelemetryRecordsSchema = Schema.Array(TelemetryRecordSchema);

export const TelemetryTraceSpanSchema = Schema.Struct({
  id: Schema.String,
  parentSpanId: Schema.NullOr(Schema.String),
  name: Schema.String,
  serviceName: Schema.String,
  startOffsetUs: Schema.Number,
  durationUs: Schema.Number,
  status: TelemetryTraceSpanStatusSchema,
  // Extra metadata mirrored from `TelemetrySpanRecordSchema` so the trace
  // explorer's "Fields" tab can show the same level of detail as the log
  // stream's details panel without a second round trip per span.
  statusMessage: Schema.NullOr(Schema.String),
  attributes: Schema.Record(Schema.String, Schema.Unknown),
  events: Schema.Array(TelemetrySpanEventSchema),
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

export const TelemetryRecordPageSchema = Schema.Struct({
  entries: TelemetryRecordsSchema,
  pageInfo: TelemetryLogPageInfoSchema,
});

export type TelemetryRecordPage = Schema.Schema.Type<typeof TelemetryRecordPageSchema>;

export const TelemetryFilterFieldKindSchema = Schema.Literals(["string", "number", "enum"]);

export type TelemetryFilterFieldKind = Schema.Schema.Type<typeof TelemetryFilterFieldKindSchema>;

export const TelemetryFilterCatalogEntrySchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  datasetId: Schema.String,
  path: Schema.Array(Schema.String),
  label: Schema.String,
  kind: TelemetryFilterFieldKindSchema,
  values: Schema.Array(Schema.String),
  frequency: Schema.Number,
  highCardinality: Schema.Boolean,
  updatedAt: Schema.String,
});

export type TelemetryFilterCatalogEntry = Schema.Schema.Type<
  typeof TelemetryFilterCatalogEntrySchema
>;

export const TelemetryFilterCatalogChangeEventSchema = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("upsert"),
    value: TelemetryFilterCatalogEntrySchema,
  }),
  Schema.Struct({
    action: Schema.Literal("delete"),
    id: Schema.String,
  }),
]);

export type TelemetryFilterCatalogChangeEvent = Schema.Schema.Type<
  typeof TelemetryFilterCatalogChangeEventSchema
>;

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
const decodeTelemetryRecordSchema = Schema.decodeUnknownSync(TelemetryRecordSchema);
const decodeTelemetryRecordPageSchema = Schema.decodeUnknownSync(TelemetryRecordPageSchema);
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

export function decodeTelemetryRecord(input: unknown): TelemetryRecord {
  return decodeTelemetryRecordSchema(input);
}

export function decodeTelemetryRecordPage(input: unknown): TelemetryRecordPage {
  return decodeTelemetryRecordPageSchema(input);
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

class ListDatasetStorageStats extends Rpc.make("ListDatasetStorageStats", {
  success: Schema.Array(DatasetStorageStatsSchema),
}) {}

class ClearDatasetData extends Rpc.make("ClearDatasetData", {
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

class GetAppSettings extends Rpc.make("GetAppSettings", {
  success: AppSettingsSchema,
}) {}

class UpdateAppSettings extends Rpc.make("UpdateAppSettings", {
  payload: UpdateAppSettingsInputSchema,
  success: AppSettingsSchema,
}) {}

export const DatasetRpcGroup = RpcGroup.make(
  ListDatasets,
  GetDataset,
  ListDatasetStorageStats,
  ClearDatasetData,
  SubscribeDatasetEvents,
  GetAppSettings,
  UpdateAppSettings,
);

class SubscribeTelemetryLogEvents extends Rpc.make("SubscribeTelemetryLogEvents", {
  payload: {
    projectId: Schema.String,
    datasetId: Schema.String,
    /**
     * Optional filter AST applied server-side to reduce WebSocket traffic.
     * The web client re-subscribes whenever the committed filter changes so
     * the server-side pre-filter stays in sync with the UI.
     */
    filter: Schema.optional(FilterNodeSchema),
  },
  success: TelemetryLogEntrySchema,
  stream: true,
}) {}

class SubscribeTelemetryEvents extends Rpc.make("SubscribeTelemetryEvents", {
  payload: {
    projectId: Schema.String,
    datasetId: Schema.String,
    filter: Schema.optional(FilterNodeSchema),
  },
  success: TelemetryRecordSchema,
  stream: true,
}) {}

class ListTelemetryFilterCatalog extends Rpc.make("ListTelemetryFilterCatalog", {
  payload: {
    projectId: Schema.String,
    datasetId: Schema.String,
  },
  success: Schema.Array(TelemetryFilterCatalogEntrySchema),
}) {}

class SubscribeTelemetryFilterCatalogEvents extends Rpc.make(
  "SubscribeTelemetryFilterCatalogEvents",
  {
    payload: {
      projectId: Schema.String,
      datasetId: Schema.String,
    },
    success: TelemetryFilterCatalogChangeEventSchema,
    stream: true,
  },
) {}

export const TelemetryLogRpcGroup = RpcGroup.make(
  SubscribeTelemetryLogEvents,
  SubscribeTelemetryEvents,
  ListTelemetryFilterCatalog,
  SubscribeTelemetryFilterCatalogEvents,
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

const decodeAppSettingsSchema = Schema.decodeUnknownSync(AppSettingsSchema);
const decodeAppMetaSchema = Schema.decodeUnknownSync(AppMetaSchema);

export function decodeAppSettings(input: unknown): AppSettings {
  return decodeAppSettingsSchema(input);
}

export function decodeAppMeta(input: unknown): AppMeta {
  return decodeAppMetaSchema(input);
}
