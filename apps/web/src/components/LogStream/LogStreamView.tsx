import { useDeferredValue, useEffect, useRef, useState } from "react";

import { listDatasetLogs } from "~/data/logApi";

import { LogStreamHeader } from "./LogStreamHeader";
import { LogTable, type LogTableHandle } from "./LogTable";
import type { DateRangePreset, LogEntry, SourceIconKind } from "./types";

interface LogStreamViewProps {
  projectId: string;
  datasetId: string;
  datasetName: string;
  datasetIcon?: SourceIconKind;
}

/**
 * Full-height live log stream view shown when a dataset is selected.
 * Fetches the real dataset log stream from the local server and refreshes
 * it periodically so recent OTLP ingests show up without a full reload.
 */
export function LogStreamView({
  projectId,
  datasetId,
  datasetName,
  datasetIcon = "js",
}: LogStreamViewProps) {
  const [searchValue, setSearchValue] = useState("");
  const [dateRange, _setDateRange] = useState<DateRangePreset>("Last 30 days");
  const [logs, setLogs] = useState<ReadonlyArray<LogEntry>>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const tableRef = useRef<LogTableHandle | null>(null);
  const deferredSearchValue = useDeferredValue(searchValue);

  useEffect(() => {
    let cancelled = false;
    let timerId: number | undefined;

    const load = async () => {
      try {
        const entries = await listDatasetLogs(projectId, datasetId, {
          search: deferredSearchValue || undefined,
          limit: 500,
        });
        if (cancelled) {
          return;
        }

        setLogs(entries.map((entry) => toLogEntry(entry, datasetName, datasetIcon)));
        setErrorMessage(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : "Failed to load logs.");
      } finally {
        if (cancelled) {
          return;
        }

        setIsLoading(false);
        timerId = window.setTimeout(load, 5_000);
      }
    };

    setIsLoading(true);
    void load();

    return () => {
      cancelled = true;
      if (timerId !== undefined) {
        window.clearTimeout(timerId);
      }
    };
  }, [datasetIcon, datasetId, datasetName, deferredSearchValue, projectId]);

  const handleScrollClick = () => {
    const table = tableRef.current;
    if (!table) {
      return;
    }
    table.scrollToBottom();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background/40">
      <LogStreamHeader
        datasetIcon={datasetIcon}
        datasetName={datasetName}
        dateRange={dateRange}
        onScrollClick={handleScrollClick}
        onSearchChange={setSearchValue}
        searchValue={searchValue}
      />
      {errorMessage ? (
        <div className="border-b border-rose-500/20 bg-rose-500/8 px-4 py-2 font-mono text-[11px] text-rose-200">
          {errorMessage}
        </div>
      ) : null}
      <LogTable logs={logs} ref={tableRef} waiting={errorMessage === null || isLoading} />
    </div>
  );
}

function toLogEntry(
  entry: {
    readonly id: string;
    readonly timestamp: string;
    readonly sourceName: string;
    readonly level: LogEntry["level"];
    readonly message: string;
  },
  datasetName: string,
  datasetIcon: SourceIconKind,
): LogEntry {
  const parsedTimestamp = new Date(entry.timestamp);

  return {
    id: entry.id,
    timestamp: Number.isNaN(parsedTimestamp.getTime()) ? new Date() : parsedTimestamp,
    sourceName: entry.sourceName || datasetName,
    sourceIcon: inferSourceIcon(entry.sourceName, datasetIcon),
    level: entry.level,
    message: entry.message,
  };
}

function inferSourceIcon(sourceName: string, fallback: SourceIconKind): SourceIconKind {
  const normalized = sourceName.trim().toLowerCase();
  if (normalized.includes("typescript") || normalized.includes("lensflare")) {
    return "ts";
  }
  if (normalized.includes("javascript") || normalized.endsWith("-js")) {
    return "js";
  }
  if (normalized.includes("python") || normalized.endsWith("-py")) {
    return "py";
  }
  if (normalized.includes("ruby") || normalized.endsWith("-rb")) {
    return "rb";
  }
  if (normalized.includes("rust") || normalized.endsWith("-rs")) {
    return "rs";
  }
  if (normalized.includes("golang") || normalized === "go" || normalized.endsWith("-go")) {
    return "go";
  }
  if (normalized.includes("java")) {
    return "java";
  }
  return fallback;
}
