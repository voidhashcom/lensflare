import { useSyncExternalStore } from "react";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { restartDesktopLocalServer } from "./desktopBridge";

interface RpcConnectionIssue {
  readonly title: string;
  readonly description: string;
  readonly detail: string;
}

interface RpcConnectionState {
  readonly issue: RpcConnectionIssue | null;
  readonly retryError: string | null;
  readonly retrying: boolean;
}

const listeners = new Set<() => void>();

const initialState: RpcConnectionState = {
  issue: null,
  retryError: null,
  retrying: false,
};

let state = initialState;

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
  return new URL("/api/health", window.location.href).toString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatRpcConnectionIssue(error: RpcClientError): RpcConnectionIssue {
  switch (error.reason._tag) {
    case "SocketOpenError":
      return {
        title: "Local server unavailable",
        description:
          "Lensflare could not open its RPC socket to the local server. Retry after the server is reachable again.",
        detail: error.reason.message,
      };
    case "SocketCloseError":
      return {
        title: "Local server connection lost",
        description:
          "Lensflare lost its RPC socket connection to the local server. Retry will attempt to restore it.",
        detail: error.reason.message,
      };
    default:
      return {
        title: "RPC connection failed",
        description:
          "Lensflare cannot communicate with the local RPC server right now. Retry will attempt to recover the connection.",
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

async function checkServerHealth(timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timerId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(getHealthCheckUrl(), {
      cache: "no-store",
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timerId);
  }
}

async function waitForHealthyServer() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await checkServerHealth(1_500)) {
      return;
    }

    if (attempt < 7) {
      await delay(1_000);
    }
  }

  throw new Error("Lensflare still cannot reach the local server.");
}

export function reportRpcConnectionFailure(error: unknown): void {
  if (!isRecoverableRpcConnectionFailure(error)) {
    return;
  }

  updateState(() => ({
    issue: formatRpcConnectionIssue(error),
    retryError: null,
    retrying: false,
  }));
}

export function subscribeToRpcConnection(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getRpcConnectionState(): RpcConnectionState {
  return state;
}

export function useRpcConnectionState(): RpcConnectionState {
  return useSyncExternalStore(
    subscribeToRpcConnection,
    getRpcConnectionState,
    getRpcConnectionState,
  );
}

export async function retryRpcConnection(): Promise<void> {
  if (state.issue === null || state.retrying) {
    return;
  }

  updateState((current) => ({
    ...current,
    retryError: null,
    retrying: true,
  }));

  try {
    const serverHealthy = await checkServerHealth(800);

    if (!serverHealthy) {
      await restartDesktopLocalServer();
    }

    await waitForHealthyServer();

    const { resetRpcRuntime } = await import("./rpc");
    await resetRpcRuntime();

    updateState(() => initialState);
    window.location.reload();
  } catch (error) {
    updateState((current) => ({
      ...current,
      retryError: formatRetryError(error),
      retrying: false,
    }));
  }
}
