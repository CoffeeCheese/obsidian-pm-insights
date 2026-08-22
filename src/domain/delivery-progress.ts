import type {
  DeliveryProgressSettings,
  DeliveryStageId,
  TaskRecord
} from "../model";

export const DELIVERY_STAGE_IDS: DeliveryStageId[] = ["design", "development", "testing"];

export type StageProgressState = "progress" | "skipped" | "missing";

export interface StageProgressMetric {
  completed: number;
  total: number;
  percentage: number | null;
  state: StageProgressState;
  weight: number;
}

export interface AcceptanceProgressMetric {
  accepted: number;
  pending: number;
  notReady: number;
  total: number;
  percentage: number | null;
  weight: number;
}

export interface DeliveryProgressQuality {
  unclassifiedTaskCount: number;
  conflictingTaskCount: number;
  unlinkedTaskCount: number;
  missingPrerequisiteCount: number;
  prematureCompletionCount: number;
  issues: DeliveryProgressIssue[];
}

export type DeliveryProgressIssue =
  | {
    kind: "unclassified" | "conflicting" | "unlinked" | "premature-completion";
    task: TaskRecord;
  }
  | {
    kind: "missing-prerequisite";
    task: TaskRecord;
    stageId: DeliveryStageId;
  };

export interface DeliveryProgressSnapshot {
  stages: Record<DeliveryStageId, StageProgressMetric>;
  acceptance: AcceptanceProgressMetric;
  totalPercentage: number | null;
  rootTaskCount: number;
  quality: DeliveryProgressQuality;
}

export interface DeliveryProgressOptions {
  projectIds: Set<string>;
  includeArchived: boolean;
  settings: DeliveryProgressSettings;
}

interface ClassifiedTask {
  task: TaskRecord;
  rootKey: string;
  stageId: DeliveryStageId;
}

function key(task: Pick<TaskRecord, "projectId" | "id">): string {
  return `${task.projectId}\u0000${task.id}`;
}

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percentage(completed: number, total: number): number | null {
  return total > 0 ? round((completed / total) * 100) : null;
}

function isCancelled(task: TaskRecord): boolean {
  const status = task.status.trim().toLocaleLowerCase();
  return status === "cancelled" || status === "canceled";
}

export function normalizeProgressTag(tag: string): string {
  return tag.normalize("NFKC").trim().replace(/^#+/u, "").toLocaleLowerCase();
}

function tagMatches(tag: string, mappedTag: string): boolean {
  return tag === mappedTag || tag.startsWith(`${mappedTag}/`);
}

function matchedStages(
  task: TaskRecord,
  settings: DeliveryProgressSettings
): DeliveryStageId[] {
  const taskTags = task.tags.map(normalizeProgressTag).filter(Boolean);
  return DELIVERY_STAGE_IDS.filter((stageId) => {
    const mapped = settings.stages[stageId].tags.map(normalizeProgressTag).filter(Boolean);
    return mapped.some((mappedTag) => taskTags.some((tag) => tagMatches(tag, mappedTag)));
  });
}

export function deliveryWeightTotal(settings: DeliveryProgressSettings): number {
  return round(
    DELIVERY_STAGE_IDS.reduce((total, stageId) => total + settings.stages[stageId].weight, 0)
      + settings.acceptanceWeight
  );
}

export function hasDeliveryTagMappingConflict(settings: DeliveryProgressSettings): boolean {
  const mappings = DELIVERY_STAGE_IDS.flatMap((stageId) =>
    settings.stages[stageId].tags
      .map(normalizeProgressTag)
      .filter(Boolean)
      .map((tag) => ({ stageId, tag }))
  );
  return mappings.some((mapping, index) => mappings.slice(index + 1).some((candidate) =>
    mapping.stageId !== candidate.stageId
      && (
        mapping.tag === candidate.tag
        || mapping.tag.startsWith(`${candidate.tag}/`)
        || candidate.tag.startsWith(`${mapping.tag}/`)
      )
  ));
}

export function aggregateDeliveryProgress(
  tasks: TaskRecord[],
  options: DeliveryProgressOptions
): DeliveryProgressSnapshot {
  const selected = tasks.filter((task) => options.projectIds.has(task.projectId));
  const byKey = new Map(selected.map((task) => [key(task), task]));
  const explicitRoots = selected.filter((task) => task.hierarchy === "root");
  const rootByKey = new Map(explicitRoots.map((task) => [key(task), task]));
  const eligibleRootKeys = new Set(
    explicitRoots
      .filter((task) => !isCancelled(task) && (options.includeArchived || !task.archived))
      .map(key)
  );
  const parentIds = new Set(
    selected
      .map((task) => task.parentId ? taskKey(task.projectId, task.parentId) : null)
      .filter((value): value is string => value !== null)
  );
  const resolvedRoots = new Map<string, string | null>();

  const resolveRoot = (task: TaskRecord): string | null => {
    const ownKey = key(task);
    const cached = resolvedRoots.get(ownKey);
    if (cached !== undefined) return cached;
    const seen = new Set<string>([ownKey]);
    let current = task;
    while (current.parentId) {
      const parentKey = taskKey(current.projectId, current.parentId);
      if (seen.has(parentKey)) break;
      seen.add(parentKey);
      const parent = byKey.get(parentKey);
      if (!parent) break;
      if (rootByKey.has(parentKey)) {
        resolvedRoots.set(ownKey, parentKey);
        return parentKey;
      }
      current = parent;
    }
    resolvedRoots.set(ownKey, null);
    return null;
  };

  let unlinkedTaskCount = 0;
  let unclassifiedTaskCount = 0;
  let conflictingTaskCount = 0;
  const classified: ClassifiedTask[] = [];
  const issues: DeliveryProgressIssue[] = [];

  for (const task of selected) {
    if (task.hierarchy === "root" || isCancelled(task)) continue;
    if (!options.includeArchived && task.archived) continue;
    const rootKey = resolveRoot(task);
    if (!rootKey) {
      unlinkedTaskCount += 1;
      issues.push({ kind: "unlinked", task });
      continue;
    }
    if (!eligibleRootKeys.has(rootKey)) continue;
    if (parentIds.has(key(task))) continue;
    const stages = matchedStages(task, options.settings);
    if (stages.length === 0) {
      unclassifiedTaskCount += 1;
      issues.push({ kind: "unclassified", task });
      continue;
    }
    if (stages.length > 1) {
      conflictingTaskCount += 1;
      issues.push({ kind: "conflicting", task });
      continue;
    }
    const [stageId] = stages;
    if (stageId) classified.push({ task, rootKey, stageId });
  }

  const stages = Object.fromEntries(
    DELIVERY_STAGE_IDS.map((stageId) => {
      const stageTasks = classified.filter((entry) => entry.stageId === stageId);
      const completed = stageTasks.filter((entry) => entry.task.completed).length;
      const total = stageTasks.length;
      const skipped = total === 0 && options.settings.stages[stageId].skipWhenEmpty;
      return [stageId, {
        completed,
        total,
        percentage: percentage(completed, total),
        state: total > 0 ? "progress" : skipped ? "skipped" : "missing",
        weight: options.settings.stages[stageId].weight
      } satisfies StageProgressMetric];
    })
  ) as Record<DeliveryStageId, StageProgressMetric>;

  let accepted = 0;
  let pending = 0;
  let notReady = 0;
  let missingPrerequisiteCount = 0;
  let prematureCompletionCount = 0;

  for (const rootKey of eligibleRootKeys) {
    const root = rootByKey.get(rootKey);
    if (!root) continue;
    let prerequisitesMet = true;
    for (const stageId of DELIVERY_STAGE_IDS) {
      const stage = options.settings.stages[stageId];
      if (!stage.acceptancePrerequisite) continue;
      const stageTasks = classified.filter(
        (entry) => entry.rootKey === rootKey && entry.stageId === stageId
      );
      if (stageTasks.length === 0) {
        if (!stage.skipWhenEmpty) {
          prerequisitesMet = false;
          missingPrerequisiteCount += 1;
          issues.push({ kind: "missing-prerequisite", task: root, stageId });
        }
        continue;
      }
      if (stageTasks.some((entry) => !entry.task.completed)) prerequisitesMet = false;
    }

    if (prerequisitesMet && root.completed) {
      accepted += 1;
    } else if (prerequisitesMet) {
      pending += 1;
    } else {
      notReady += 1;
      if (root.completed) {
        prematureCompletionCount += 1;
        issues.push({ kind: "premature-completion", task: root });
      }
    }
  }

  const rootTaskCount = eligibleRootKeys.size;
  const acceptance: AcceptanceProgressMetric = {
    accepted,
    pending,
    notReady,
    total: rootTaskCount,
    percentage: percentage(accepted, rootTaskCount),
    weight: options.settings.acceptanceWeight
  };

  let weightedProgress = 0;
  let activeWeight = 0;
  for (const stageId of DELIVERY_STAGE_IDS) {
    const metric = stages[stageId];
    if (metric.state === "skipped") continue;
    activeWeight += metric.weight;
    weightedProgress += metric.weight * (metric.percentage ?? 0);
  }
  if (acceptance.total > 0) {
    activeWeight += acceptance.weight;
    weightedProgress += acceptance.weight * (acceptance.percentage ?? 0);
  }

  return {
    stages,
    acceptance,
    totalPercentage: rootTaskCount > 0 && activeWeight > 0
      ? round(weightedProgress / activeWeight)
      : null,
    rootTaskCount,
    quality: {
      unclassifiedTaskCount,
      conflictingTaskCount,
      unlinkedTaskCount,
      missingPrerequisiteCount,
      prematureCompletionCount,
      issues
    }
  };
}
