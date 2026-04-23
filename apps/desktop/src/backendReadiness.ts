/**
 * Desktop-only readiness helper. The Electron main process uses this to
 * hold off loading the renderer window until the local server is actually
 * answering `GET /api/health`. We can't rely on the server's `startLocalServer`
 * promise resolving — Effect's `NodeHttpServer.layer` finishes booting
 * before the OS-level listen callback has produced an accepting socket in
 * every edge case (immediate restarts, port-reuse on macOS), so the
 * renderer would open its RPC WebSocket a tick early and bounce.
 *
 * The helper is intentionally minimal and free of Effect runtime deps so
 * it can run against whichever URL the current `LocalServerHandle` exposes
 * without plumbing a Layer stack through the main process.
 */
export interface WaitForHttpReadyOptions {
  /** Full URL to poll. Expect a 2xx response when healthy. */
  readonly url: string;
  /** Total wait budget. Defaults to 30s. */
  readonly timeoutMs?: number;
  /** Delay between attempts. Defaults to 100ms. */
  readonly intervalMs?: number;
  /** Per-attempt request timeout. Defaults to 1s. */
  readonly requestTimeoutMs?: number;
  /**
   * Optional abort signal. When aborted the helper rejects with
   * {@link BackendReadinessAbortedError} regardless of remaining timeout.
   * Used by the lifecycle state machine to cancel an in-flight readiness
   * wait when a newer restart supersedes it.
   */
  readonly signal?: AbortSignal;
}

export class BackendReadinessAbortedError extends Error {
  override readonly name = "BackendReadinessAbortedError";
}

export class BackendReadinessTimeoutError extends Error {
  override readonly name = "BackendReadinessTimeoutError";
  readonly url: string;
  readonly timeoutMs: number;
  constructor(message: string, url: string, timeoutMs: number) {
    super(message);
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new BackendReadinessAbortedError("Readiness wait aborted."));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new BackendReadinessAbortedError("Readiness wait aborted."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function probe(
  url: string,
  requestTimeoutMs: number,
  outerSignal: AbortSignal | undefined,
): Promise<boolean> {
  if (outerSignal?.aborted) {
    throw new BackendReadinessAbortedError("Readiness wait aborted.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  const onOuterAbort = () => controller.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    if (outerSignal?.aborted) {
      throw new BackendReadinessAbortedError("Readiness wait aborted.");
    }
    return false;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Poll `options.url` until it answers with a 2xx response or the timeout
 * elapses. The caller provides the full URL — typically
 * `` `${handle.httpBaseUrl}/api/health` `` — because the helper does not
 * know about the server's routing.
 *
 * Rejects with {@link BackendReadinessAbortedError} if `signal` aborts
 * mid-wait, or {@link BackendReadinessTimeoutError} if the budget is
 * exhausted.
 */
export async function waitForHttpReady(options: WaitForHttpReadyOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 100;
  const requestTimeoutMs = options.requestTimeoutMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const ok = await probe(options.url, requestTimeoutMs, options.signal);
    if (ok) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new BackendReadinessTimeoutError(
        `Local server did not become healthy within ${timeoutMs}ms.`,
        options.url,
        timeoutMs,
      );
    }

    const remaining = deadline - Date.now();
    await delay(Math.min(intervalMs, Math.max(remaining, 0)), options.signal);
  }
}
