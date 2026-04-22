import { useMemo, useRef, useState } from "react";

import { LogStreamHeader } from "./LogStreamHeader";
import { LogTable, type LogTableHandle } from "./LogTable";
import { LogVolumeHistogram } from "./LogVolumeHistogram";
import { generateMockHistogram, generateMockLogs } from "./mockLogs";
import type { DateRangePreset, SourceIconKind } from "./types";

interface LogStreamViewProps {
  datasetName: string;
  datasetIcon?: SourceIconKind;
}

/**
 * Full-height live log stream view shown when a dataset is selected.
 * Composition of four pieces: header controls, volume histogram, log table
 * and a waiting-for-logs footer. All data is mocked for now so the visual
 * shell can be reviewed before wiring up the backing query.
 */
export function LogStreamView({ datasetName, datasetIcon = "js" }: LogStreamViewProps) {
  const [searchValue, setSearchValue] = useState("");
  const [dateRange, _setDateRange] = useState<DateRangePreset>("Last 30 days");
  const tableRef = useRef<LogTableHandle | null>(null);

  const histogram = useMemo(() => generateMockHistogram(96, hashSeed(datasetName)), [datasetName]);
  // Generate a large, stable corpus of mock rows so the scroll region feels
  // realistic before the live query backend is wired up.
  const logs = useMemo(
    () => generateMockLogs(datasetName, 2_000, datasetIcon),
    [datasetName, datasetIcon],
  );

  const handleScrollClick = () => {
    const table = tableRef.current;
    if (!table) {
      return;
    }
    if (table.isNearBottom()) {
      table.scrollToTop();
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
      {/* <LogVolumeHistogram buckets={histogram} /> */}
      <LogTable logs={logs} ref={tableRef} waiting />
    </div>
  );
}

function hashSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash || 1;
}
