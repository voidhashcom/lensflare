import { Filter, type FilterNode } from "@lensflare/contracts";
import { useCallback, useSyncExternalStore } from "react";

export interface LogFilterPreset {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly filter: FilterNode | null;
  readonly readonly: boolean;
  readonly icon?: "logs" | "traces" | "errorSpans" | undefined;
}

export interface EditableLogFilterPreset extends Omit<LogFilterPreset, "readonly"> {
  readonly readonly?: false;
}

const STORAGE_VERSION = 1;
const STORAGE_KEY_PREFIX = "lensflare.log-filter-presets";

export const DEFAULT_LOG_FILTER_PRESETS: ReadonlyArray<LogFilterPreset> = [
  {
    id: "default:logs",
    name: "Logs",
    source: "kind:log",
    filter: Filter.cmp(["kind"], "eq", Filter.stringValue("log")),
    icon: "logs",
    readonly: true,
  },
  {
    id: "default:traces",
    name: "Traces",
    source: "kind:span parentSpanId:notExists:",
    filter: Filter.and([
      Filter.cmp(["kind"], "eq", Filter.stringValue("span")),
      Filter.cmp(["parentSpanId"], "notExists"),
    ]),
    icon: "traces",
    readonly: true,
  },
  {
    id: "default:error-spans",
    name: "Error spans",
    source: "kind:span status:error",
    filter: Filter.and([
      Filter.cmp(["kind"], "eq", Filter.stringValue("span")),
      Filter.cmp(["status"], "eq", Filter.stringValue("error")),
    ]),
    icon: "errorSpans",
    readonly: true,
  },
];

interface StoredPresetPayload {
  readonly version: number;
  readonly presets: ReadonlyArray<EditableLogFilterPreset>;
}

const listeners = new Set<() => void>();
let lastSnapshotKey: string | null = null;
let lastSnapshot: ReadonlyArray<LogFilterPreset> | null = null;

function emit(): void {
  lastSnapshotKey = null;
  lastSnapshot = null;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function storageKey(projectId: string, datasetId: string): string {
  return `${STORAGE_KEY_PREFIX}:${encodeURIComponent(projectId)}:${encodeURIComponent(datasetId)}`;
}

function readCustomPresets(
  projectId: string,
  datasetId: string,
): ReadonlyArray<EditableLogFilterPreset> {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(storageKey(projectId, datasetId));
    if (raw === null) return [];

    const parsed = JSON.parse(raw) as Partial<StoredPresetPayload>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.presets)) {
      return [];
    }

    return parsed.presets
      .map((preset): EditableLogFilterPreset | null => {
        if (
          typeof preset?.id !== "string" ||
          typeof preset.name !== "string" ||
          typeof preset.source !== "string"
        ) {
          return null;
        }

        return {
          id: preset.id,
          name: preset.name,
          source: preset.source,
          filter: (preset.filter ?? null) as FilterNode | null,
        };
      })
      .filter((preset): preset is EditableLogFilterPreset => preset !== null);
  } catch {
    return [];
  }
}

function writeCustomPresets(
  projectId: string,
  datasetId: string,
  presets: ReadonlyArray<EditableLogFilterPreset>,
): void {
  if (!canUseLocalStorage()) {
    return;
  }

  const payload: StoredPresetPayload = {
    version: STORAGE_VERSION,
    presets,
  };
  window.localStorage.setItem(storageKey(projectId, datasetId), JSON.stringify(payload));
}

function getSnapshot(projectId: string, datasetId: string): ReadonlyArray<LogFilterPreset> {
  const key = storageKey(projectId, datasetId);
  if (lastSnapshotKey === key && lastSnapshot !== null) {
    return lastSnapshot;
  }

  lastSnapshotKey = key;
  lastSnapshot = [
    ...DEFAULT_LOG_FILTER_PRESETS,
    ...readCustomPresets(projectId, datasetId).map((preset) => ({
      ...preset,
      readonly: false as const,
    })),
  ];
  return lastSnapshot;
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useLogFilterPresets(
  projectId: string,
  datasetId: string,
): ReadonlyArray<LogFilterPreset> {
  const getProjectDatasetSnapshot = useCallback(
    () => getSnapshot(projectId, datasetId),
    [datasetId, projectId],
  );

  return useSyncExternalStore(subscribe, getProjectDatasetSnapshot, getProjectDatasetSnapshot);
}

export function createLogFilterPreset(
  projectId: string,
  datasetId: string,
  input: Omit<EditableLogFilterPreset, "id">,
): void {
  const presets = readCustomPresets(projectId, datasetId);
  writeCustomPresets(projectId, datasetId, [
    ...presets,
    {
      id: createId(),
      ...input,
    },
  ]);
  emit();
}

export function updateLogFilterPreset(
  projectId: string,
  datasetId: string,
  id: string,
  patch: Partial<Omit<EditableLogFilterPreset, "id">>,
): void {
  const presets = readCustomPresets(projectId, datasetId);
  writeCustomPresets(
    projectId,
    datasetId,
    presets.map((preset) => (preset.id === id ? { ...preset, ...patch } : preset)),
  );
  emit();
}

export function deleteLogFilterPreset(projectId: string, datasetId: string, id: string): void {
  writeCustomPresets(
    projectId,
    datasetId,
    readCustomPresets(projectId, datasetId).filter((preset) => preset.id !== id),
  );
  emit();
}
