import type { Dataset, ProjectEntity } from "@lensflare/contracts";
import { useLiveQuery } from "@tanstack/react-db";
import { RefreshCwIcon, Trash2Icon } from "lucide-react";
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
import { clearDatasetData, listDatasetStorageStats } from "~/data/datasetApi";

import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

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
 * General settings for app-level data management.
 */
export function GeneralSettingsPanel() {
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
              <div className="bg-muted/30 px-3 py-2">
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
          <div className="border-border/60 border-t py-3 text-destructive text-xs">
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
