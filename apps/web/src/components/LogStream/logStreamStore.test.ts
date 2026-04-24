import { Filter, type TelemetryRecord, type TelemetryRecordPage } from "@lensflare/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listDatasetTelemetry,
  subscribeDatasetTelemetryEntries,
} from "~/data/logApi";

import {
  activateDatasetStream,
  configureLogStreamStoreForTests,
  deactivateDatasetStream,
  getDatasetStreamSnapshot,
  getLogStreamStoreSessionCountForTests,
  invalidateDatasetTelemetry,
  loadOlderDatasetTelemetry,
  refreshDatasetTelemetry,
  resetLogStreamStoreForTests,
  selectDatasetTelemetryEntry,
  setDatasetStreamFilter,
} from "./logStreamStore";

afterEach(() => {
  resetLogStreamStoreForTests();
});

describe("logStreamStore", () => {
  it("starts one subscription for repeated activation of the same dataset", async () => {
    const { listTelemetry, subscribeTelemetry } = installFakes({
      pages: [page([logRecord("log-1", "ready")])],
    });

    activateDatasetStream(baseInput());
    await flushStream("p", "d");
    deactivateDatasetStream("p", "d");
    activateDatasetStream(baseInput());

    expect(subscribeTelemetry).toHaveBeenCalledTimes(1);
    expect(listTelemetry).toHaveBeenCalledTimes(1);
    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["log-1"]);
  });

  it("merges incoming websocket entries into visible logs", async () => {
    const fakes = installFakes({ pages: [page([])] });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    fakes.emit("p", "d", logRecord("log-2", "live"));

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["log-2"]);
  });

  it("keeps inactive recent datasets subscribed and current", async () => {
    const fakes = installFakes({ pages: [page([])] });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");
    deactivateDatasetStream("p", "d");

    fakes.emit("p", "d", logRecord("log-3", "inactive live"));

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["log-3"]);
  });

  it("filters incoming events after the applied filter changes", async () => {
    const fakes = installFakes({ pages: [page([]), page([])] });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    setDatasetStreamFilter({
      projectId: "p",
      datasetId: "d",
      source: "level:error ",
      filter: Filter.cmp(["level"], "eq", Filter.stringValue("error")),
    });
    fakes.emit("p", "d", logRecord("log-info", "info", "info"));
    fakes.emit("p", "d", logRecord("log-error", "error", "error"));

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["log-error"]);
  });

  it("derives filtered rows immediately from raw recent websocket data", async () => {
    const fakes = installFakes({ pages: [page([]), page([])] });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");
    fakes.emit("p", "d", logRecord("log-info", "info", "info"));
    fakes.emit("p", "d", logRecord("log-error", "error", "error"));

    setDatasetStreamFilter({
      projectId: "p",
      datasetId: "d",
      source: "level:error ",
      filter: Filter.cmp(["level"], "eq", Filter.stringValue("error")),
    });

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["log-error"]);
  });

  it("deduplicates concurrent older-page loads", async () => {
    const { listTelemetry } = installFakes({
      pages: [
        page([logRecord("new", "new", "info", "2026-01-01T00:00:10.000Z")], {
          hasPreviousPage: true,
          startCursor: "cursor",
        }),
        page([logRecord("old", "old", "info", "2026-01-01T00:00:01.000Z")]),
      ],
    });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    await Promise.all([
      loadOlderDatasetTelemetry("p", "d"),
      loadOlderDatasetTelemetry("p", "d"),
    ]);

    expect(listTelemetry).toHaveBeenCalledTimes(2);
    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["old", "new"]);
  });

  it("does not trim away an explicitly loaded older page", async () => {
    const latestRecords = Array.from({ length: 1_000 }, (_, index) =>
      logRecord(
        `new-${index}`,
        `new ${index}`,
        "info",
        new Date(Date.UTC(2026, 0, 1, 0, 1, index)).toISOString(),
      ),
    );
    installFakes({
      pages: [
        page(latestRecords, { hasPreviousPage: true, startCursor: "cursor" }),
        page([logRecord("old", "old", "info", "2026-01-01T00:00:01.000Z")]),
      ],
    });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    await loadOlderDatasetTelemetry("p", "d");

    const ids = getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id);
    expect(ids).toHaveLength(1_001);
    expect(ids[0]).toBe("old");
  });

  it("preserves loaded older rows and the older cursor across latest-page refreshes", async () => {
    installFakes({
      pages: [
        page([logRecord("new", "new", "info", "2026-01-01T00:00:10.000Z")], {
          hasPreviousPage: true,
          startCursor: "cursor-new",
          endCursor: "end-new",
        }),
        page([logRecord("old", "old", "info", "2026-01-01T00:00:01.000Z")], {
          hasPreviousPage: true,
          startCursor: "cursor-old",
          endCursor: "end-old",
        }),
        page([logRecord("newer", "newer", "info", "2026-01-01T00:00:20.000Z")], {
          hasPreviousPage: true,
          startCursor: "cursor-newer",
          endCursor: "end-newer",
        }),
      ],
    });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");
    await loadOlderDatasetTelemetry("p", "d");

    await refreshDatasetTelemetry("p", "d");

    const snapshot = getDatasetStreamSnapshot("p", "d");
    expect(snapshot.logs.map((log) => log.id)).toEqual(["old", "new", "newer"]);
    expect(snapshot.pageInfo?.startCursor).toBe("cursor-old");
    expect(snapshot.pageInfo?.endCursor).toBe("end-newer");
  });

  it("keeps the selected older detail open when live entries arrive", async () => {
    const fakes = installFakes({
      pages: [
        page([logRecord("new", "new", "info", "2026-01-01T00:00:10.000Z")], {
          hasPreviousPage: true,
          startCursor: "cursor",
        }),
        page([logRecord("old", "old", "info", "2026-01-01T00:00:01.000Z")]),
      ],
    });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");
    await loadOlderDatasetTelemetry("p", "d");
    selectDatasetTelemetryEntry("p", "d", "old");

    fakes.emit("p", "d", logRecord("live", "live", "info", "2026-01-01T00:00:20.000Z"));

    const snapshot = getDatasetStreamSnapshot("p", "d");
    expect(snapshot.logs.map((log) => log.id)).toEqual(["old", "new", "live"]);
    expect(snapshot.selectedLogId).toBe("old");
    expect(snapshot.selectedLog?.id).toBe("old");
  });

  it("keeps row order stable when same-millisecond records arrive later", async () => {
    const fakes = installFakes({
      pages: [
        page([
          logRecord("z-first", "first", "info", "2026-01-01T00:00:00.000000100Z"),
          logRecord("a-last", "last", "info", "2026-01-01T00:00:00.000000300Z"),
        ]),
      ],
    });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    fakes.emit("p", "d", logRecord("m-middle", "middle", "info", "2026-01-01T00:00:00.000000200Z"));

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual([
      "z-first",
      "m-middle",
      "a-last",
    ]);
  });

  it("delays live rows so logs and spans can be sorted into correct positions together", async () => {
    const fakes = installFakes({
      liveFlushDelayMs: 15,
      pages: [
        page([
          logRecord("old", "old", "info", "2026-01-01T00:00:00.000000100Z"),
          logRecord("new", "new", "info", "2026-01-01T00:00:00.000000400Z"),
        ]),
      ],
    });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    fakes.emit("p", "d", logRecord("live-log", "live", "info", "2026-01-01T00:00:00.000000300Z"));
    fakes.emit("p", "d", spanRecord("live-span", "span", "2026-01-01T00:00:00.000000200Z"));

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["old", "new"]);

    await wait(25);

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual([
      "old",
      "live-span",
      "live-log",
      "new",
    ]);
  });

  it("deduplicates a live record that also appears in a refreshed page", async () => {
    const fakes = installFakes({
      pages: [
        page([]),
        page([logRecord("same", "from refresh", "info", "2026-01-01T00:00:00.000000100Z")]),
      ],
    });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");
    fakes.emit("p", "d", logRecord("same", "from websocket", "info", "2026-01-01T00:00:00.000000100Z"));

    await refreshDatasetTelemetry("p", "d");

    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["same"]);
  });

  it("queues a filtered first-page load when the filter changes during an in-flight load", async () => {
    const firstPage = deferred<TelemetryRecordPage>();
    const secondPage = deferred<TelemetryRecordPage>();
    const listTelemetry: typeof listDatasetTelemetry = vi
      .fn()
      .mockImplementationOnce(() => firstPage.promise)
      .mockImplementationOnce(() => secondPage.promise);
    const subscribeTelemetry: typeof subscribeDatasetTelemetryEntries = vi.fn(() => () => {});
    configureLogStreamStoreForTests({
      listTelemetry,
      subscribeTelemetry,
      preloadFilterCatalog: vi.fn(async () => {}),
      liveFlushDelayMs: 0,
    });

    activateDatasetStream(baseInput());
    setDatasetStreamFilter({
      projectId: "p",
      datasetId: "d",
      source: "level:error ",
      filter: Filter.cmp(["level"], "eq", Filter.stringValue("error")),
    });

    firstPage.resolve(page([logRecord("log-info", "info", "info")]));
    await flushStream("p", "d");
    expect(listTelemetry).toHaveBeenCalledTimes(2);

    secondPage.resolve(page([logRecord("log-error", "error", "error")]));
    await flushStream("p", "d");

    expect(listTelemetry).toHaveBeenLastCalledWith("p", "d", {
      limit: 100,
      filter: Filter.cmp(["level"], "eq", Filter.stringValue("error")),
    });
    expect(getDatasetStreamSnapshot("p", "d").logs.map((log) => log.id)).toEqual(["log-error"]);
  });

  it("evicts inactive sessions beyond the recent-dataset cap", async () => {
    const fakes = installFakes({
      pages: Array.from({ length: 5 }, () => page([])),
    });

    for (let index = 0; index < 5; index += 1) {
      const datasetId = `d-${index}`;
      activateDatasetStream(baseInput({ datasetId }));
      await flushStream("p", datasetId);
      deactivateDatasetStream("p", datasetId);
    }

    expect(getLogStreamStoreSessionCountForTests()).toBe(4);
    expect(fakes.cancelCount()).toBe(1);
  });

  it("keeps selected log state across route deactivation and reactivation", async () => {
    installFakes({ pages: [page([logRecord("log-selected", "selected")])] });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    selectDatasetTelemetryEntry("p", "d", "log-selected");
    deactivateDatasetStream("p", "d");
    activateDatasetStream(baseInput());

    const snapshot = getDatasetStreamSnapshot("p", "d");
    expect(snapshot.selectedLogId).toBe("log-selected");
    expect(snapshot.selectedLog?.id).toBe("log-selected");
  });

  it("invalidates a dataset and cancels its subscription", async () => {
    const fakes = installFakes({ pages: [page([])] });
    activateDatasetStream(baseInput());
    await flushStream("p", "d");

    invalidateDatasetTelemetry("p", "d");

    expect(fakes.cancelCount()).toBe(1);
    expect(getLogStreamStoreSessionCountForTests()).toBe(0);
  });
});

function baseInput(overrides: { readonly datasetId?: string } = {}) {
  return {
    projectId: "p",
    datasetId: overrides.datasetId ?? "d",
    metadata: {
      datasetName: "Dataset",
      datasetIcon: "js" as const,
    },
  };
}

function installFakes({
  pages,
  liveFlushDelayMs = 0,
}: {
  readonly pages: ReadonlyArray<TelemetryRecordPage>;
  readonly liveFlushDelayMs?: number;
}) {
  const callbacks = new Map<string, (entry: TelemetryRecord) => void>();
  let cancelled = 0;
  let pageIndex = 0;

  const listTelemetry: typeof listDatasetTelemetry = vi.fn(async () => {
    const next = pages[pageIndex] ?? page([]);
    pageIndex += 1;
    return next;
  });
  const subscribeTelemetry: typeof subscribeDatasetTelemetryEntries = vi.fn(
    (projectId, datasetId, onEntry) => {
      callbacks.set(`${projectId}:${datasetId}`, onEntry);
      return () => {
        cancelled += 1;
      };
    },
  );

  configureLogStreamStoreForTests({
    listTelemetry,
    subscribeTelemetry,
    preloadFilterCatalog: vi.fn(async () => {}),
    liveFlushDelayMs,
  });

  return {
    listTelemetry,
    subscribeTelemetry,
    emit(projectId: string, datasetId: string, entry: TelemetryRecord) {
      callbacks.get(`${projectId}:${datasetId}`)?.(entry);
    },
    cancelCount() {
      return cancelled;
    },
  };
}

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushStream(projectId: string, datasetId: string): Promise<void> {
  await wait(0);
  const snapshot = getDatasetStreamSnapshot(projectId, datasetId);
  if (snapshot.isInitialLoading || snapshot.isRefreshing) {
    await wait(0);
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function page(
  entries: ReadonlyArray<TelemetryRecord>,
  pageInfo: Partial<TelemetryRecordPage["pageInfo"]> = {},
): TelemetryRecordPage {
  return {
    entries,
    pageInfo: {
      hasPreviousPage: pageInfo.hasPreviousPage ?? false,
      hasNextPage: pageInfo.hasNextPage ?? false,
      startCursor: pageInfo.startCursor ?? null,
      endCursor: pageInfo.endCursor ?? null,
    },
  };
}

function logRecord(
  id: string,
  message: string,
  level: "info" | "error" = "info",
  timestamp = `2026-01-01T00:00:0${id.length % 10}.000Z`,
): TelemetryRecord {
  return {
    id,
    kind: "log",
    timestamp,
    sourceName: "node",
    level,
    message,
    severityNumber: level === "error" ? 17 : 9,
    severityText: level,
    serviceName: "api",
    traceId: null,
    spanId: null,
    attributes: {},
  };
}

function spanRecord(id: string, name: string, timestamp: string): TelemetryRecord {
  return {
    id,
    kind: "span",
    timestamp,
    sourceName: "node",
    traceId: `trace-${id}`,
    spanId: `span-${id}`,
    parentSpanId: null,
    name,
    serviceName: "api",
    status: "ok",
    statusMessage: null,
    durationUs: 1_000,
    attributes: {},
    events: [],
  };
}
