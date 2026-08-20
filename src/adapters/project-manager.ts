import { App, TFile } from "obsidian";
import type { PriorityRecord, ProjectRecord, TaskHierarchy, TaskRecord } from "../model";

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

export interface ProjectManagerSnapshot {
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  priorities: PriorityRecord[];
}

interface ProjectManagerSettings {
  completeStatuses: Set<string>;
  priorities: PriorityRecord[];
}

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
    const settings = await this.readSettings();
    const projects: ProjectRecord[] = [];
    const tasks: TaskRecord[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!frontmatter) continue;

      if (truthy(frontmatter["pm-project"])) {
        const project = this.project(file, frontmatter);
        if (project) projects.push(project);
      } else if (truthy(frontmatter["pm-task"])) {
        const task = this.task(file, frontmatter, settings.completeStatuses);
        if (task) tasks.push(task);
      }
    }

    return {
      projects: projects.sort((left, right) => left.title.localeCompare(right.title)),
      tasks,
      priorities: settings.priorities
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
      priority: optionalText(frontmatter.priority),
      assignees: stringList(frontmatter.assignees),
      estimate: number(frontmatter.timeEstimate),
      logged: loggedHours(frontmatter.timeLogs),
      progress,
      completed:
        Boolean(optionalText(frontmatter.completed)) || progress >= 100 || completeStatuses.has(status),
      archived: truthy(frontmatter.archived)
    };
  }

  private async readSettings(): Promise<ProjectManagerSettings> {
    const completeStatuses = new Set(["done", "completed", "cancelled", "canceled"]);
    let priorities = DEFAULT_PRIORITIES;
    const path = `${this.app.vault.configDir}/plugins/project-manager/data.json`;
    try {
      if (await this.app.vault.adapter.exists(path)) {
        const parsed = JSON.parse(await this.app.vault.adapter.read(path)) as ProjectManagerSettingsFile;
        for (const status of parsed.statuses ?? []) {
          if (status.complete === true && typeof status.id === "string") {
            completeStatuses.add(status.id);
          }
        }
        const configuredPriorities = (parsed.priorities ?? []).flatMap((priority) => {
          const id = text(priority.id).trim();
          if (!id) return [];
          return [{
            id,
            label: text(priority.label, id).trim() || id,
            color: text(priority.color).trim()
          }];
        });
        if (configuredPriorities.length > 0) priorities = configuredPriorities;
      }
    } catch {
      // Project Manager's settings are optional compatibility hints. Task
      // frontmatter and the built-in priority definitions remain available.
    }
    return { completeStatuses, priorities };
  }
}
