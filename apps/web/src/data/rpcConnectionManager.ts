import type { DesktopLocalServerState } from "@lensflare/contracts";
import { Cause, Effect, Exit } from "effect";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { useSyncExternalStore } from "react";
import { captureWebEvent } from "~/analytics";
import { resolveBackendHttpUrl } from "./backendTarget";
import {
  getDesktopLocalServerState,
  hasDesktopBridge,
  restartDesktopLocalServer,
  subscribeToDesktopLocalServerState,
} from "./desktopBridge";
import {
  CatalogRpcClient,
  type CatalogRpcClientShape,
  createRpcRuntime,
  type RpcRuntime,
} from "./rpc";

/**
 * The web renderer's single source of truth for the RPC transport lifecycle.
 *
 * Responsibilities:
 *   1. Own the {@link RpcRuntime} and recreate it on every reconnect so
 *      Effect's layer memoization can't hand callers a stale socket.
 *   2. Track an "active subscription" registry. TanStack DB collections
 *      register their subscription factories here; on reconnect every
 *      factory is re-invoked against the freshly built runtime so snapshots
 *      re-hydrate automatically.
 *   3. Drive the reconnect state machine — auto-retry with bounded
 *      backoff, manual retry via {@link reconnect}, and a final
 *      `window.location.reload()` fallback when the manager gives up.
 *   4. Surface connection state to React via {@link useConnectionState}.
 *
 * {@link ../data/rpcConnection} from the pre-refactor codebase only owned
 * (3) and (4), leaked the runtime via a global mutable binding, and
 * needed a full page reload to rehydrate subscriptions. This module
 * replaces it.
 */

export interface RpcConnectionIssue {
  readonly title: string;
  readonly description: string;
  readonly detail: string;
}

export interface RpcConnectionState {
  readonly issue: RpcConnectionIssue | null;
  readonly retryError: string | null;
  readonly retrying: boolean;
  readonly autoRetrying: boolean;
  readonly attempts: number;
}

interface ActiveSubscription {
  readonly factory: (client: CatalogRpcClientShape) => Effect.Effect<unknown, unknown>;
  readonly onError: ((error: unknown) => void) | undefined;
  cancel: (() => void) | undefined;
}

const initialState: RpcConnectionState = {
  issue: null,
  retryError: null,
  retrying: false,
  autoRetrying: false,
  attempts: 0,
};

const listeners = new Set<() => void>();
const subscriptions = new Set<ActiveSubscription>();

let runtime: RpcRuntime = createRpcRuntime();
let state: RpcConnectionState = initialState;
let reconnectPromise: Promise<void> | null = null;
let autoReconnectTimer: number | null = null;

/**
 * Cap on the consecutive failures we'll paper over before surfacing the
 * manual-retry UI. After this many attempts the auto-retry loop stops and
 * the user has to click "Retry connection" themselves.
 */
const MAX_AUTO_RECONNECT_ATTEMPTS = 4;

const AUTO_RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_500] as const;

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function updateState(update: (current: RpcConnectionState) => RpcConnectionState) {
  state = update(state);
  emitChange();
}

function getHealthCheckUrl(): string {
  return resolveBackendHttpUrl("/api/health");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatIssue(error: RpcClientError): RpcConnectionIssue {
  switch (error.reason._tag) {
    case "SocketOpenError":
      return {
        title: "Local server unavailable",
        description:
          "Lensflare could not open its RPC socket to the local server. It will keep retrying automatically.",
        detail: error.reason.message,
      };
    case "SocketCloseError":
      return {
        title: "Local server connection lost",
        description:
          "Lensflare lost its RPC socket connection to the local server. It will keep retrying automatically.",
        detail: error.reason.message,
      };
    default:
      return {
        title: "RPC connection failed",
        description:
          "Lensflare cannot communicate with the local RPC server right now. It will keep retrying automatically.",
        detail: error.message,
      };
  }
}

function formatRetryError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "Lensflare still cannot reach the local server.";
}

function isRecoverableRpcConnectionFailure(error: unknown): error is RpcClientError {
  return error instanceof RpcClientError && error.reason._tag !== "RpcClientDefect";
}

function extractRecoverableRpcFailure(error: unknown): RpcClientError | null {
  if (isRecoverableRpcConnectionFailure(error)) {
    return error;
  }

  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (isRecoverableRpcConnectionFailure(cause)) {
      return cause;
    }
  }

  return null;
}

async function checkServerHealth(timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(getHealthCheckUrl(), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timerId);
  }
}

async function waitForHealthyServer(attempts: number, perAttemptTimeoutMs: number): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await checkServerHealth(perAttemptTimeoutMs)) {
      return;
    }

    if (attempt < attempts - 1) {
      await delay(500);
    }
  }

  throw new Error("Lensflare still cannot reach the local server.");
}

function startSubscription(subscription: ActiveSubscription): void {
  subscription.cancel?.();

  subscription.cancel = runtime.runCallback(
    Effect.flatMap(CatalogRpcClient.asEffect(), (client) => subscription.factory(client)),
    {
      onExit: (exit) => {
        if (!Exit.isFailure(exit) || Cause.hasInterruptsOnly(exit.cause)) {
          return;
        }

        const error = Cause.squash(exit.cause);
        subscription.onError?.(error);
        reportRpcConnectionFailure(error);
      },
    },
  );
}

function rehydrateSubscriptions(): void {
  for (const subscription of subscriptions) {
    startSubscription(subscription);
  }
}

function cancelAllSubscriptions(): void {
  for (const subscription of subscriptions) {
    subscription.cancel?.();
    subscription.cancel = undefined;
  }
}

async function resetRuntime(): Promise<void> {
  const previous = runtime;
  runtime = createRpcRuntime();

  try {
    await previous.dispose();
  } catch {
    // Ignore disposal failures while forcing a fresh runtime for retry flows.
  }
}

interface ReconnectOptions {
  readonly triggeredBy: "auto" | "manual" | "desktop-state";
}

async function performReconnect(options: ReconnectOptions): Promise<void> {
  cancelAllSubscriptions();

  const serverHealthy = await checkServerHealth(800);
  if (!serverHealthy && hasDesktopBridge()) {
    await restartDesktopLocalServer();
  }

  await waitForHealthyServer(8, 1_500);

  await resetRuntime();

  rehydrateSubscriptions();

  updateState(() => initialState);
  captureWebEvent("backend_connected", {
    connectionSource: options.triggeredBy,
  });

  if (options.triggeredBy === "manual") {
    // A manual retry that reaches this line means the user saw the modal
    // and clicked through — we've already rehydrated collections, no
    // reload needed.
    return;
  }
}

function scheduleAutoReconnect(): void {
  if (autoReconnectTimer !== null) {
    return;
  }

  const attempt = state.attempts;
  if (attempt >= MAX_AUTO_RECONNECT_ATTEMPTS) {
    updateState((current) => ({ ...current, autoRetrying: false }));
    return;
  }

  const delayMs = AUTO_RECONNECT_DELAYS_MS[attempt] ?? AUTO_RECONNECT_DELAYS_MS.at(-1)!;
  updateState((current) => ({ ...current, autoRetrying: true }));

  autoReconnectTimer = window.setTimeout(() => {
    autoReconnectTimer = null;
    void reconnect({ triggeredBy: "auto" }).catch(() => {
      // Swallow — `reconnect` handles state updates itself.
    });
  }, delayMs);
}

async function reconnect(options: ReconnectOptions): Promise<void> {
  if (reconnectPromise) {
    return reconnectPromise;
  }

  updateState((current) => ({
    ...current,
    retryError: null,
    retrying: options.triggeredBy === "manual",
    autoRetrying: options.triggeredBy !== "manual",
    attempts: current.attempts + 1,
  }));

  reconnectPromise = (async () => {
    try {
      await performReconnect(options);
    } catch (error) {
      updateState((current) => ({
        ...current,
        retryError: formatRetryError(error),
        retrying: false,
        autoRetrying: false,
      }));

      if (options.triggeredBy !== "manual") {
        scheduleAutoReconnect();
      }
    }
  })().finally(() => {
    reconnectPromise = null;
  });

  return reconnectPromise;
}

export function reportRpcConnectionFailure(error: unknown): void {
  const failure = extractRecoverableRpcFailure(error);
  if (!failure) {
    return;
  }

  if (state.issue === null) {
    updateState((current) => ({
      ...current,
      issue: formatIssue(failure),
    }));
  }

  scheduleAutoReconnect();
}

export function subscribeToConnectionState(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConnectionState(): RpcConnectionState {
  return state;
}

export function useConnectionState(): RpcConnectionState {
  return useSyncExternalStore(subscribeToConnectionState, getConnectionState, getConnectionState);
}

/**
 * Manually trigger a reconnect — used by the retry button. If the
 * reconnect succeeds, the UI clears; if it fails again, `state.retryError`
 * carries the message so the user sees why.
 */
export async function retryConnection(): Promise<void> {
  await reconnect({ triggeredBy: "manual" });
}

/**
 * Final fallback when auto/manual retries cannot recover. The caller
 * typically wires this behind a visible "Reload Lensflare" button so the
 * reload is explicit.
 */
export function reloadApp(): void {
  window.location.reload();
}

/**
 * Run a one-shot RPC call on the current runtime. Transport failures are
 * surfaced to the reconnect UI via {@link reportRpcConnectionFailure} and
 * then rethrown to the caller, which is expected to wrap them with its
 * own domain-specific formatter (see `~/data/projectApi`,
 * `~/data/datasetApi`).
 */
export async function runRpc<A>(
  f: (client: CatalogRpcClientShape) => Effect.Effect<A, unknown>,
): Promise<A> {
  try {
    return await runtime.runPromise(Effect.flatMap(CatalogRpcClient.asEffect(), f));
  } catch (error) {
    reportRpcConnectionFailure(error);
    throw error;
  }
}

export interface RpcSubscriptionOptions {
  /**
   * Called if the subscription effect fails with a recoverable defect. The
   * manager already reports the error to {@link reportRpcConnectionFailure}
   * (so auto-reconnect kicks in) — this callback is the caller's hook to
   * surface the error in its own domain terms (e.g. annotate a collection's
   * `lastError` state).
   */
  readonly onError?: (error: unknown) => void;
}

/**
 * Register a long-running subscription effect. The `factory` is invoked
 * with the current {@link CatalogRpcClient} on start and on every
 * subsequent reconnect, so callers can rely on a fresh closure (and fresh
 * per-attempt state) for each run. Returns a disposer that both cancels
 * the current fiber and removes the subscription from the rehydration
 * registry.
 */
export function runRpcCallback(
  factory: (client: CatalogRpcClientShape) => Effect.Effect<unknown, unknown>,
  options: RpcSubscriptionOptions = {},
): () => void {
  const subscription: ActiveSubscription = {
    factory,
    onError: options.onError,
    cancel: undefined,
  };

  subscriptions.add(subscription);
  startSubscription(subscription);

  return () => {
    subscriptions.delete(subscription);
    subscription.cancel?.();
    subscription.cancel = undefined;
  };
}

/**
 * Install a listener on the desktop bridge so a main-process-initiated
 * restart (e.g. user-triggered via the tray/menu) immediately forces a
 * reconnect in the renderer. Safe to call outside the desktop shell —
 * {@link subscribeToDesktopLocalServerState} returns a no-op in that
 * case.
 */
function initializeDesktopStateBridge(): void {
  if (!hasDesktopBridge()) {
    return;
  }

  // Best-effort prime: if we boot into a non-ready state, surface the
  // appropriate reconnect UI immediately rather than waiting for the first
  // failed RPC call.
  void getDesktopLocalServerState().then((initial) => {
    if (initial && (initial.status === "restarting" || initial.status === "starting")) {
      updateState((current) => ({
        ...current,
        issue: current.issue ?? {
          title: "Local server starting",
          description:
            "The desktop shell is preparing its local server. Lensflare will connect automatically.",
          detail: `status=${initial.status}`,
        },
      }));
      scheduleAutoReconnect();
    }
  });

  subscribeToDesktopLocalServerState((nextState: DesktopLocalServerState) => {
    switch (nextState.status) {
      case "ready":
        // A fresh `ready` event while we hold an outstanding issue means
        // the server came back up out-of-band (e.g. the user clicked a
        // native restart affordance). Kick a reconnect to rehydrate.
        if (state.issue !== null && reconnectPromise === null) {
          void reconnect({ triggeredBy: "desktop-state" }).catch(() => {});
        }
        return;
      case "restarting":
      case "starting":
        if (state.issue === null) {
          updateState((current) => ({
            ...current,
            issue: {
              title: "Local server restarting",
              description: "The desktop shell is restarting its local server.",
              detail: `status=${nextState.status}`,
            },
          }));
        }
        return;
      case "failed":
        updateState((current) => ({
          ...current,
          issue: current.issue ?? {
            title: "Local server failed",
            description: "The desktop shell could not start its local server.",
            detail: nextState.message,
          },
          retryError: nextState.message,
          retrying: false,
          autoRetrying: false,
        }));
        return;
    }
  });
}

initializeDesktopStateBridge();
