import type { PriorityRecord, ProjectRecord, TaskHierarchy, TaskRecord } from "../model";

export interface ProjectManagerDocument {
  path: string;
  basename: string;
  frontmatter: Record<string, unknown> | null;
}

export interface ProjectManagerSourceSnapshot {
  documents: readonly ProjectManagerDocument[];
  settings: Record<string, unknown> | null;
}

export type ProjectManagerSourceChange =
  | { kind: "upsert"; document: ProjectManagerDocument }
  | { kind: "remove"; path: string; recursive?: boolean }
  | { kind: "reconcile" };

export interface ProjectManagerSource {
  scan(): Promise<ProjectManagerSourceSnapshot>;
  watch(listener: (change: ProjectManagerSourceChange) => void): () => void;
}

export interface ProjectManagerSnapshot {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  priorities: PriorityRecord[];
}

interface ProjectManagerStatus {
  id?: unknown;
  complete?: unknown;
}

interface ProjectManagerPriority {
  id?: unknown;
  label?: unknown;
  color?: unknown;
}

interface ProjectManagerSettingsFile {
  statuses?: ProjectManagerStatus[];
  priorities?: ProjectManagerPriority[];
}

interface ProjectManagerSettings {
  completeStatuses: Set<string>;
  priorities: PriorityRecord[];
}

type CatalogEntry =
  | { kind: "project"; record: ProjectRecord }
  | { kind: "task"; record: TaskRecord };

const DEFAULT_PRIORITIES: PriorityRecord[] = [
  { id: "critical", label: "Critical", color: "#c47070" },
  { id: "high", label: "High", color: "#b8a06b" },
  { id: "medium", label: "Medium", color: "#8a94a0" },
  { id: "low", label: "Low", color: "#79b58d" }
];

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optionalText(value: unknown): string | null {
  const result = text(value).trim();
  return result ? result : null;
}

function number(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) && result > 0 ? result : 0;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function taskTags(value: unknown): string[] {
  return stringList(value)
    .map((tag) => tag.trim().replace(/^#+/u, ""))
    .filter(Boolean);
}

function loggedHours(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return (value as unknown[]).reduce<number>((total, item) => {
    if (!item || typeof item !== "object") return total;
    return total + number((item as { hours?: unknown }).hours);
  }, 0);
}

function truthy(value: unknown): boolean {
  return value === true || value === "true";
}

function taskHierarchy(value: unknown): TaskHierarchy {
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLocaleLowerCase();
  if (normalized === "task") return "root";
  if (normalized === "subtask") return "subtask";
  return "unknown";
}

function settings(value: Record<string, unknown> | null): ProjectManagerSettings {
  const completeStatuses = new Set(["done", "completed", "cancelled", "canceled"]);
  let priorities = DEFAULT_PRIORITIES.map((priority) => ({ ...priority }));
  const parsed = value as ProjectManagerSettingsFile | null;

  for (const status of parsed?.statuses ?? []) {
    if (status.complete === true && typeof status.id === "string") {
      completeStatuses.add(status.id);
    }
  }

  const configuredPriorities = (parsed?.priorities ?? []).flatMap((priority) => {
    const id = text(priority.id).trim();
    if (!id) return [];
    return [{
      id,
      label: text(priority.label, id).trim() || id,
      color: text(priority.color).trim()
    }];
  });
  if (configuredPriorities.length > 0) priorities = configuredPriorities;

  return { completeStatuses, priorities };
}

function project(document: ProjectManagerDocument): ProjectRecord | null {
  const frontmatter = document.frontmatter;
  if (!frontmatter) return null;
  const id = text(frontmatter.id).trim();
  if (!id) return null;
  return {
    id,
    title: text(frontmatter.title, document.basename).trim() || document.basename,
    path: document.path,
    icon: text(frontmatter.icon, "📋")
  };
}

function task(
  document: ProjectManagerDocument,
  completeStatuses: Set<string>
): TaskRecord | null {
  const frontmatter = document.frontmatter;
  if (!frontmatter) return null;
  const id = text(frontmatter.id).trim();
  const projectId = text(frontmatter.projectId).trim();
  if (!id || !projectId) return null;

  const status = text(frontmatter.status, "todo");
  const progress = number(frontmatter.progress);
  return {
    id,
    projectId,
    parentId: optionalText(frontmatter.parentId),
    hierarchy: taskHierarchy(frontmatter.type),
    title: text(frontmatter.title, document.basename).trim() || document.basename,
    path: document.path,
    status,
    priority: optionalText(frontmatter.priority),
    tags: taskTags(frontmatter.tags),
    assignees: stringList(frontmatter.assignees),
    estimate: number(frontmatter.timeEstimate),
    logged: loggedHours(frontmatter.timeLogs),
    progress,
    completed:
      Boolean(optionalText(frontmatter.completed)) || progress >= 100 || completeStatuses.has(status),
    archived: truthy(frontmatter.archived)
  };
}

function entry(
  document: ProjectManagerDocument,
  completeStatuses: Set<string>
): CatalogEntry | null {
  const frontmatter = document.frontmatter;
  if (!frontmatter) return null;
  if (truthy(frontmatter["pm-project"])) {
    const record = project(document);
    return record ? { kind: "project", record } : null;
  }
  if (truthy(frontmatter["pm-task"])) {
    const record = task(document, completeStatuses);
    return record ? { kind: "task", record } : null;
  }
  return null;
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function entriesEqual(left: CatalogEntry | undefined, right: CatalogEntry | null): boolean {
  if (!left && !right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "project" && right.kind === "project") {
    return left.record.id === right.record.id
      && left.record.title === right.record.title
      && left.record.path === right.record.path
      && left.record.icon === right.record.icon;
  }
  if (left.kind !== "task" || right.kind !== "task") return false;
  return left.record.id === right.record.id
    && left.record.projectId === right.record.projectId
    && left.record.parentId === right.record.parentId
    && left.record.hierarchy === right.record.hierarchy
    && left.record.title === right.record.title
    && left.record.path === right.record.path
    && left.record.status === right.record.status
    && left.record.priority === right.record.priority
    && stringArraysEqual(left.record.tags, right.record.tags)
    && stringArraysEqual(left.record.assignees, right.record.assignees)
    && left.record.estimate === right.record.estimate
    && left.record.logged === right.record.logged
    && left.record.progress === right.record.progress
    && left.record.completed === right.record.completed
    && left.record.archived === right.record.archived;
}

function prioritiesEqual(left: PriorityRecord[], right: PriorityRecord[]): boolean {
  return left.length === right.length && left.every((priority, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && priority.id === candidate.id
      && priority.label === candidate.label
      && priority.color === candidate.color;
  });
}

export class ProjectManagerCatalog {
  private readonly entries = new Map<string, CatalogEntry>();
  private readonly listeners = new Set<(snapshot: ProjectManagerSnapshot) => void>();
  private current: ProjectManagerSnapshot | null = null;
  private currentSettings = settings(null);
  private operation: Promise<ProjectManagerSnapshot> | null = null;
  private queuedChanges: ProjectManagerSourceChange[] = [];
  private reconcileQueued = false;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly source: ProjectManagerSource) {}

  async snapshot(): Promise<ProjectManagerSnapshot> {
    if (this.current) return this.current;
    return this.replaceFromSource(false);
  }

  async reconcile(): Promise<ProjectManagerSnapshot> {
    return this.replaceFromSource(true);
  }

  subscribe(listener: (snapshot: ProjectManagerSnapshot) => void): () => void {
    this.listeners.add(listener);
    this.ensureWatching();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.stopWatching) {
        this.stopWatching();
        this.stopWatching = null;
      }
    };
  }

  private ensureWatching(): void {
    if (this.stopWatching) return;
    this.stopWatching = this.source.watch((change) => this.receive(change));
  }

  private async replaceFromSource(notify: boolean): Promise<ProjectManagerSnapshot> {
    if (this.operation) return this.operation;
    this.ensureWatching();
    const previous = this.current;
    const operation = (async () => {
      const sourceSnapshot = await this.source.scan();
      const nextSettings = settings(sourceSnapshot.settings);
      const nextEntries = new Map<string, CatalogEntry>();
      for (const document of sourceSnapshot.documents) {
        const next = entry(document, nextSettings.completeStatuses);
        if (next) nextEntries.set(document.path, next);
      }

      this.entries.clear();
      for (const [path, next] of nextEntries) this.entries.set(path, next);
      this.currentSettings = nextSettings;
      this.current = this.createSnapshot();

      const queued = this.queuedChanges;
      this.queuedChanges = [];
      for (const change of queued) this.apply(change, false);

      if (notify && previous !== null && !this.snapshotsEqual(previous, this.current)) {
        this.notify();
      }
      return this.current;
    })();
    this.operation = operation;
    try {
      return await operation;
    } finally {
      this.operation = null;
      if (this.reconcileQueued) {
        this.reconcileQueued = false;
        void this.reconcile().catch(() => undefined);
      }
    }
  }

  private receive(change: ProjectManagerSourceChange): void {
    if (this.operation) {
      if (change.kind === "reconcile") this.reconcileQueued = true;
      else this.queuedChanges.push(change);
      return;
    }
    if (change.kind === "reconcile") {
      void this.reconcile().catch(() => undefined);
      return;
    }
    if (!this.current) return;
    this.apply(change, true);
  }

  private apply(change: ProjectManagerSourceChange, notify: boolean): void {
    if (change.kind === "reconcile") return;
    let changed = false;
    if (change.kind === "upsert") {
      const next = entry(change.document, this.currentSettings.completeStatuses);
      const previous = this.entries.get(change.document.path);
      if (!entriesEqual(previous, next)) {
        if (next) this.entries.set(change.document.path, next);
        else this.entries.delete(change.document.path);
        changed = true;
      }
    } else if (change.recursive) {
      const prefix = `${change.path}/`;
      for (const path of [...this.entries.keys()]) {
        if (path === change.path || path.startsWith(prefix)) {
          this.entries.delete(path);
          changed = true;
        }
      }
    } else {
      changed = this.entries.delete(change.path);
    }

    if (!changed) return;
    this.current = this.createSnapshot();
    if (notify) this.notify();
  }

  private createSnapshot(): ProjectManagerSnapshot {
    const projects: ProjectRecord[] = [];
    const tasks: TaskRecord[] = [];
    for (const catalogEntry of this.entries.values()) {
      if (catalogEntry.kind === "project") projects.push(catalogEntry.record);
      else tasks.push(catalogEntry.record);
    }
    return {
      projects: projects.sort((left, right) => left.title.localeCompare(right.title)),
      tasks,
      priorities: this.currentSettings.priorities.map((priority) => ({ ...priority }))
    };
  }

  private notify(): void {
    if (!this.current) return;
    for (const listener of this.listeners) listener(this.current);
  }

  private snapshotsEqual(left: ProjectManagerSnapshot, right: ProjectManagerSnapshot): boolean {
    if (!prioritiesEqual(left.priorities, right.priorities)) return false;
    if (left.projects.length !== right.projects.length || left.tasks.length !== right.tasks.length) {
      return false;
    }
    const leftEntries = new Map<string, CatalogEntry>();
    for (const record of left.projects) leftEntries.set(record.path, { kind: "project", record });
    for (const record of left.tasks) leftEntries.set(record.path, { kind: "task", record });
    for (const record of right.projects) {
      if (!entriesEqual(leftEntries.get(record.path), { kind: "project", record })) return false;
    }
    for (const record of right.tasks) {
      if (!entriesEqual(leftEntries.get(record.path), { kind: "task", record })) return false;
    }
    return true;
  }
}
