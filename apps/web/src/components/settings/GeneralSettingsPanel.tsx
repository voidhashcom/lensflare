import type { Dataset, ProjectEntity } from "@lensflare/contracts";
import { useLiveQuery } from "@tanstack/react-db";
import { DatabaseIcon, RefreshCwIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { datasetsCollection } from "~/collections/datasetsCollection";
import { projectsCollection } from "~/collections/projectsCollection";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { clearDatasetData, listDatasetStorageStats } from "~/data/datasetApi";

import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";

type ThemeValue = "system" | "light" | "dark";
type TimestampValue = "locale" | "12-hour" | "24-hour";

const DEFAULTS = {
  theme: "system" as ThemeValue,
  timestampFormat: "locale" as TimestampValue,
  autoRefresh: true,
  confirmDelete: true,
  streamTailing: true,
} as const;

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeValue; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const TIMESTAMP_OPTIONS: ReadonlyArray<{ value: TimestampValue; label: string }> = [
  { value: "locale", label: "System default" },
  { value: "12-hour", label: "12-hour" },
  { value: "24-hour", label: "24-hour" },
];

function selectDatasets(q: any) {
  return q
    .from({ dataset: datasetsCollection })
    .orderBy(({ dataset }: any) => dataset.projectId)
    .orderBy(({ dataset }: any) => dataset.name)
    .select(({ dataset }: any) => ({
      createdAt: dataset.createdAt,
      id: dataset.id,
      name: dataset.name,
      projectId: dataset.projectId,
      slug: dataset.slug,
      updatedAt: dataset.updatedAt,
    }));
}

function selectProjects(q: any) {
  return q
    .from({ project: projectsCollection })
    .orderBy(({ project }: any) => project.name)
    .select(({ project }: any) => ({
      createdAt: project.createdAt,
      icon: project.icon,
      id: project.id,
      name: project.name,
      slug: project.slug,
      updatedAt: project.updatedAt,
    }));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

/**
 * General preferences panel — theme, timestamp format, and a handful of
 * dataset / stream behaviours. Values are held in local component state for
 * now; wiring them to persistent storage can happen once the settings
 * contract lands on the server.
 */
export function GeneralSettingsPanel() {
  const [theme, setTheme] = useState<ThemeValue>(DEFAULTS.theme);
  const [timestampFormat, setTimestampFormat] = useState<TimestampValue>(DEFAULTS.timestampFormat);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(DEFAULTS.autoRefresh);
  const [confirmDelete, setConfirmDelete] = useState<boolean>(DEFAULTS.confirmDelete);
  const [streamTailing, setStreamTailing] = useState<boolean>(DEFAULTS.streamTailing);
  const [storageStats, setStorageStats] = useState<
    Awaited<ReturnType<typeof listDatasetStorageStats>>
  >([]);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<{
    dataset: Dataset;
    project: ProjectEntity | null;
  } | null>(null);
  const [clearingDatasetId, setClearingDatasetId] = useState<string | null>(null);

  const projectsQuery = useLiveQuery(selectProjects);
  const datasetsQuery = useLiveQuery(selectDatasets);
  const projects = (projectsQuery.data ?? []) as ProjectEntity[];
  const datasets = (datasetsQuery.data ?? []) as Dataset[];
  const statsByDatasetId = useMemo(
    () => new Map(storageStats.map((stat) => [stat.datasetId, stat])),
    [storageStats],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const datasetGroups = useMemo(() => {
    const groups = new Map<
      string,
      { project: ProjectEntity | null; datasets: Array<Dataset> }
    >();

    for (const dataset of datasets) {
      const group = groups.get(dataset.projectId) ?? {
        project: projectsById.get(dataset.projectId) ?? null,
        datasets: [],
      };
      group.datasets.push(dataset);
      groups.set(dataset.projectId, group);
    }

    return [...groups.entries()]
      .map(([projectId, group]) => ({
        ...group,
        projectId,
        datasets: group.datasets.toSorted((a, b) => a.name.localeCompare(b.name)),
      }))
      .toSorted((a, b) => {
        const left = a.project?.name ?? a.projectId;
        const right = b.project?.name ?? b.projectId;
        return left.localeCompare(right);
      });
  }, [datasets, projectsById]);

  const refreshStorageStats = useCallback(async () => {
    setStorageLoading(true);
    setStorageError(null);
    try {
      setStorageStats(await listDatasetStorageStats());
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not load dataset storage.");
    } finally {
      setStorageLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStorageStats();
  }, [refreshStorageStats]);

  const confirmClearDataset = useCallback(async () => {
    if (!clearTarget) {
      return;
    }

    setClearingDatasetId(clearTarget.dataset.id);
    setStorageError(null);
    try {
      await clearDatasetData(clearTarget.dataset.projectId, clearTarget.dataset.id);
      await refreshStorageStats();
      setClearTarget(null);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not clear dataset data.");
    } finally {
      setClearingDatasetId(null);
    }
  }, [clearTarget, refreshStorageStats]);

  return (
    <SettingsPageContainer>
      <SettingsSection icon={<SettingsIcon className="size-3" />} title="General">
        <SettingsRow
          control={
            <Select onValueChange={(value) => setTheme(value as ThemeValue)} value={theme}>
              <SelectTrigger aria-label="Theme" className="w-full sm:w-40">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          description="Choose how Lensflare looks across the app."
          resetAction={
            theme !== DEFAULTS.theme ? (
              <SettingResetButton label="Theme" onClick={() => setTheme(DEFAULTS.theme)} />
            ) : undefined
          }
          title="Theme"
        />
        <SettingsRow
          control={
            <Select
              onValueChange={(value) => setTimestampFormat(value as TimestampValue)}
              value={timestampFormat}
            >
              <SelectTrigger aria-label="Time format" className="w-full sm:w-40">
                <SelectValue>
                  {TIMESTAMP_OPTIONS.find((option) => option.value === timestampFormat)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {TIMESTAMP_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
          description="How timestamps appear in log rows and relative time labels."
          resetAction={
            timestampFormat !== DEFAULTS.timestampFormat ? (
              <SettingResetButton
                label="Time format"
                onClick={() => setTimestampFormat(DEFAULTS.timestampFormat)}
              />
            ) : undefined
          }
          title="Time format"
        />
      </SettingsSection>

      <SettingsSection title="Datasets">
        <SettingsRow
          control={<Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />}
          description="Refetch dataset stats in the background when a project is open."
          resetAction={
            autoRefresh !== DEFAULTS.autoRefresh ? (
              <SettingResetButton
                label="Auto-refresh datasets"
                onClick={() => setAutoRefresh(DEFAULTS.autoRefresh)}
              />
            ) : undefined
          }
          title="Auto-refresh datasets"
        />
        <SettingsRow
          control={<Switch checked={streamTailing} onCheckedChange={setStreamTailing} />}
          description="When a log stream is opened, keep it pinned to the latest records as they arrive."
          resetAction={
            streamTailing !== DEFAULTS.streamTailing ? (
              <SettingResetButton
                label="Follow new logs"
                onClick={() => setStreamTailing(DEFAULTS.streamTailing)}
              />
            ) : undefined
          }
          title="Follow new logs"
        />
        <SettingsRow
          control={<Switch checked={confirmDelete} onCheckedChange={setConfirmDelete} />}
          description="Ask for confirmation before removing a project or collection."
          resetAction={
            confirmDelete !== DEFAULTS.confirmDelete ? (
              <SettingResetButton
                label="Confirm destructive actions"
                onClick={() => setConfirmDelete(DEFAULTS.confirmDelete)}
              />
            ) : undefined
          }
          title="Confirm destructive actions"
        />
      </SettingsSection>

      <SettingsSection
        headerAction={
          <Button
            aria-label="Refresh dataset storage"
            disabled={storageLoading}
            onClick={() => void refreshStorageStats()}
            size="icon-xs"
            title="Refresh"
            variant="ghost"
          >
            <RefreshCwIcon className={storageLoading ? "size-3 animate-spin" : "size-3"} />
          </Button>
        }
        icon={<DatabaseIcon className="size-3" />}
        title="Storage"
      >
        {datasets.length === 0 ? (
          <SettingsRow
            description="Storage appears here after a dataset is created."
            title="No datasets"
          />
        ) : (
          datasetGroups.map((group) => (
            <div className="border-border/60 border-t first:border-t-0" key={group.projectId}>
              <div className="bg-muted/30 px-4 py-2.5 sm:px-5">
                <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div className="min-w-0 font-semibold text-[11px] text-foreground/70 uppercase tracking-[0.08em]">
                    <span className="truncate">{group.project?.name ?? "Unknown project"}</span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {group.project?.slug ?? group.projectId}
                  </div>
                </div>
              </div>
              {group.datasets.map((dataset) => {
                const bytes = statsByDatasetId.get(dataset.id)?.bytes ?? 0;
                const clearing = clearingDatasetId === dataset.id;
                const projectLabel = group.project?.name ?? dataset.projectId;
                return (
                  <SettingsRow
                    control={
                      <Button
                        disabled={clearing || storageLoading}
                        aria-label={`Clear data for ${projectLabel} / ${dataset.name}`}
                        onClick={() => setClearTarget({ dataset, project: group.project })}
                        size="xs"
                        variant="destructive-outline"
                      >
                        <Trash2Icon className="size-3.5" />
                        Clear
                      </Button>
                    }
                    description={dataset.slug}
                    key={dataset.id}
                    status={storageLoading ? "Checking storage..." : undefined}
                    title={
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span className="truncate">{dataset.name}</span>
                        <span className="shrink-0 font-mono text-muted-foreground text-xs">
                          {formatBytes(bytes)}
                        </span>
                      </span>
                    }
                  />
                );
              })}
            </div>
          ))
        )}
        {storageError ? (
          <div className="border-border/60 border-t px-5 py-3 text-destructive text-xs">
            {storageError}
          </div>
        ) : null}
      </SettingsSection>

      <AlertDialog
        onOpenChange={(open) => !open && setClearTarget(null)}
        open={clearTarget !== null}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Dataset Data</AlertDialogTitle>
            <AlertDialogDescription>
              {clearTarget
                ? `This will remove stored telemetry for "${clearTarget.dataset.name}" in project "${clearTarget.project?.name ?? clearTarget.dataset.projectId}".`
                : 'This will remove stored telemetry for "this dataset".'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              disabled={clearingDatasetId !== null}
              render={<Button variant="outline" />}
            >
              Cancel
            </AlertDialogClose>
            <Button
              disabled={clearingDatasetId !== null}
              onClick={() => void confirmClearDataset()}
              variant="destructive"
            >
              {clearingDatasetId !== null ? "Clearing..." : "Clear Data"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsPageContainer>
  );
}
