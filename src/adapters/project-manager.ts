import { App, TFile } from "obsidian";
import type { ProjectRecord, TaskHierarchy, TaskRecord } from "../model";

interface ProjectManagerStatus {
  id?: unknown;
  complete?: unknown;
}

interface ProjectManagerSettingsFile {
  statuses?: ProjectManagerStatus[];
}

export interface ProjectManagerSnapshot {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
}

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

function loggedHours(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return (value as unknown[]).reduce<number>((total, entry) => {
    if (!entry || typeof entry !== "object") return total;
    return total + number((entry as { hours?: unknown }).hours);
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

export class ProjectManagerAdapter {
  constructor(private readonly app: App) {}

  async read(): Promise<ProjectManagerSnapshot> {
    const completeStatuses = await this.readCompleteStatuses();
    const projects: ProjectRecord[] = [];
    const tasks: TaskRecord[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;

      if (truthy(frontmatter["pm-project"])) {
        const project = this.project(file, frontmatter);
        if (project) projects.push(project);
      } else if (truthy(frontmatter["pm-task"])) {
        const task = this.task(file, frontmatter, completeStatuses);
        if (task) tasks.push(task);
      }
    }

    return {
      projects: projects.sort((left, right) => left.title.localeCompare(right.title)),
      tasks
    };
  }

  private project(file: TFile, frontmatter: Record<string, unknown>): ProjectRecord | null {
    const id = text(frontmatter.id).trim();
    if (!id) return null;
    return {
      id,
      title: text(frontmatter.title, file.basename).trim() || file.basename,
      path: file.path,
      icon: text(frontmatter.icon, "📋")
    };
  }

  private task(
    file: TFile,
    frontmatter: Record<string, unknown>,
    completeStatuses: Set<string>
  ): TaskRecord | null {
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
      title: text(frontmatter.title, file.basename).trim() || file.basename,
      path: file.path,
      status,
      assignees: stringList(frontmatter.assignees),
      estimate: number(frontmatter.timeEstimate),
      logged: loggedHours(frontmatter.timeLogs),
      progress,
      completed:
        Boolean(optionalText(frontmatter.completed)) || progress >= 100 || completeStatuses.has(status),
      archived: truthy(frontmatter.archived)
    };
  }

  private async readCompleteStatuses(): Promise<Set<string>> {
    const defaults = new Set(["done", "completed", "cancelled", "canceled"]);
    const path = `${this.app.vault.configDir}/plugins/project-manager/data.json`;
    try {
      if (!(await this.app.vault.adapter.exists(path))) return defaults;
      const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as ProjectManagerSettingsFile;
      for (const status of parsed.statuses ?? []) {
        if (status.complete === true && typeof status.id === "string") defaults.add(status.id);
      }
    } catch {
      // Project Manager's settings are an optional compatibility hint. Task
      // completion timestamps and progress remain the primary fallback.
    }
    return defaults;
  }
}
