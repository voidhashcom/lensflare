import { Layer } from "effect";
import type * as Duration from "effect/Duration";
import { FetchHttpClient } from "effect/unstable/http";
import { OtlpLogger, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

const defaultServerOrigin = "http://127.0.0.1:43110";
const defaultProjectSlug = "lensflare";
const defaultServiceName = "app";

export interface LensflareLayerOptions {
  readonly enabled?: boolean;
  readonly env?: Record<string, string | undefined>;
  readonly environment?: string;
  readonly serverOrigin?: string;
  readonly projectSlug?: string;
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly resourceAttributes?: Record<string, unknown>;
  readonly exportInterval?: Duration.Input;
  readonly maxBatchSize?: number;
  readonly shutdownTimeout?: Duration.Input;
  readonly mergeWithExistingLogger?: boolean;
}

export interface LensflareLayerConfig {
  readonly enabled: boolean;
  readonly logsUrl: string;
  readonly tracesUrl: string;
  readonly resource: {
    readonly serviceName: string;
    readonly serviceVersion?: string;
    readonly attributes: Record<string, unknown>;
  };
  readonly exportInterval?: Duration.Input;
  readonly maxBatchSize?: number;
  readonly shutdownTimeout?: Duration.Input;
  readonly mergeWithExistingLogger: boolean;
}

function readProcessEnv(): Record<string, string | undefined> {
  const runtime = globalThis as {
    readonly process?: { readonly env?: Record<string, string | undefined> };
  };
  return runtime.process?.env ?? {};
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

export function isEnabled(options: LensflareLayerOptions = {}): boolean {
  if (options.enabled !== undefined) {
    return options.enabled;
  }

  const env = options.env ?? readProcessEnv();
  const envEnabled = parseBoolean(env.LENSFLARE_ENABLED);
  if (envEnabled !== undefined) {
    return envEnabled;
  }

  const envDev = parseBoolean(env.LENSFLARE_DEV);
  if (envDev !== undefined) {
    return envDev;
  }

  const environment = options.environment ?? env.NODE_ENV ?? env.MODE;
  return environment !== "production";
}

export function resolveLayerConfig(
  datasetSlug: string,
  options: LensflareLayerOptions = {},
): LensflareLayerConfig {
  const env = options.env ?? readProcessEnv();
  const serverOrigin = trimTrailingSlash(
    options.serverOrigin ??
      env.LENSFLARE_ORIGIN ??
      env.LENSFLARE_SERVER_ORIGIN ??
      defaultServerOrigin,
  );
  const projectSlug = options.projectSlug ?? env.LENSFLARE_PROJECT_SLUG ?? defaultProjectSlug;
  const serviceName = options.serviceName ?? env.OTEL_SERVICE_NAME ?? defaultServiceName;
  const serviceVersion = options.serviceVersion ?? env.OTEL_SERVICE_VERSION;
  const attributes = {
    "lensflare.project_slug": projectSlug,
    "lensflare.dataset_slug": datasetSlug,
    ...options.resourceAttributes,
  };

  return {
    enabled: isEnabled({ ...options, env }),
    logsUrl: `${serverOrigin}/ingest/otlp/v1/logs/${pathSegment(projectSlug)}/${pathSegment(datasetSlug)}`,
    tracesUrl: `${serverOrigin}/ingest/otlp/v1/traces/${pathSegment(projectSlug)}/${pathSegment(datasetSlug)}`,
    resource: {
      serviceName,
      ...(serviceVersion ? { serviceVersion } : {}),
      attributes,
    },
    ...(options.exportInterval ? { exportInterval: options.exportInterval } : {}),
    ...(options.maxBatchSize ? { maxBatchSize: options.maxBatchSize } : {}),
    ...(options.shutdownTimeout ? { shutdownTimeout: options.shutdownTimeout } : {}),
    mergeWithExistingLogger: options.mergeWithExistingLogger ?? true,
  };
}

export function layer(
  datasetSlug: string,
  options: LensflareLayerOptions = {},
): Layer.Layer<never> {
  const config = resolveLayerConfig(datasetSlug, options);
  if (!config.enabled) {
    return Layer.empty;
  }

  return Layer.mergeAll(
    OtlpTracer.layer({
      url: config.tracesUrl,
      resource: config.resource,
      ...(config.exportInterval ? { exportInterval: config.exportInterval } : {}),
      ...(config.maxBatchSize ? { maxBatchSize: config.maxBatchSize } : {}),
      ...(config.shutdownTimeout ? { shutdownTimeout: config.shutdownTimeout } : {}),
    }),
    OtlpLogger.layer({
      url: config.logsUrl,
      resource: config.resource,
      ...(config.exportInterval ? { exportInterval: config.exportInterval } : {}),
      ...(config.maxBatchSize ? { maxBatchSize: config.maxBatchSize } : {}),
      ...(config.shutdownTimeout ? { shutdownTimeout: config.shutdownTimeout } : {}),
      mergeWithExisting: config.mergeWithExistingLogger,
    }),
  ).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
}

export const Lensflare = {
  layer,
  isEnabled,
  resolveLayerConfig,
} as const;
