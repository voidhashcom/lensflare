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
