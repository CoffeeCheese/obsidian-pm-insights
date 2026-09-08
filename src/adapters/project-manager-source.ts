import {
  normalizePath,
  TFile,
  TFolder,
  type App,
  type CachedMetadata
} from "obsidian";
import type {
  ProjectManagerDocument,
  ProjectManagerSource,
  ProjectManagerSourceChange,
  ProjectManagerSourceSnapshot
} from "./project-manager";

const DEFAULT_PROJECTS_FOLDER = "Projects";

interface IndexedProject {
  path: string;
  id: string;
}

interface IndexedTask {
  path: string;
  id: string;
  projectPath?: string | null;
  archived?: boolean;
}

interface ProjectManagerIndex {
  ready?: boolean;
  projectRefs(): IndexedProject[];
  allTaskRefs(): IndexedTask[];
  completeStatuses?(project: IndexedProject): ReadonlySet<string>;
  onChange?(listener: () => void): () => void;
}

function settingsFolder(settings: Record<string, unknown> | null): string {
  const configured = typeof settings?.projectsFolder === "string"
    ? settings.projectsFolder.trim()
    : "";
  return normalizePath(configured || DEFAULT_PROJECTS_FOLDER);
}

function frontmatter(cache: CachedMetadata | null): Record<string, unknown> | null {
  return cache?.frontmatter as Record<string, unknown> | undefined ?? null;
}

export class ObsidianProjectManagerSource implements ProjectManagerSource {
  private managedFolder = DEFAULT_PROJECTS_FOLDER;

  constructor(private readonly app: App) {}

  async scan(): Promise<ProjectManagerSourceSnapshot> {
    const settings = await this.readSettings();
    this.managedFolder = settingsFolder(settings);
    const documents: ProjectManagerDocument[] = [];
    const index = this.index();
    if (index) {
      // Reuse PM's discovery (including exclusions) instead of scanning the vault.
      if (index.ready === false) return { documents, settings };
      const projects = new Map(index.projectRefs().map((project) => [project.path, project]));
      const statuses = new Map([...projects].map(([path, project]) =>
        [path, typeof index.completeStatuses === "function" ? index.completeStatuses(project) : undefined] as const
      ));
      for (const project of projects.values()) {
        const file = this.app.vault.getAbstractFileByPath(project.path);
        if (!(file instanceof TFile)) continue;
        const document = this.document(file, this.app.metadataCache.getFileCache(file));
        if (document.frontmatter) document.frontmatter = { ...document.frontmatter, id: project.id };
        documents.push(document);
      }
      for (const task of index.allTaskRefs()) {
        const file = this.app.vault.getAbstractFileByPath(task.path);
        if (!(file instanceof TFile)) continue;
        const document = this.document(file, this.app.metadataCache.getFileCache(file));
        const owner = task.projectPath ? projects.get(task.projectPath) : undefined;
        if (document.frontmatter) {
          document.frontmatter = {
            ...document.frontmatter,
            id: task.id,
            ...(owner ? { projectId: owner.id } : {}),
            ...(typeof task.archived === "boolean" ? { archived: task.archived } : {})
          };
          const complete = owner ? statuses.get(owner.path) : undefined;
          if (complete) {
            const status = document.frontmatter.status;
            document.statusComplete = complete.has(typeof status === "string" ? status : "todo");
          }
        }
        documents.push(document);
      }
      return { documents, settings };
    }
    const root = this.app.vault.getAbstractFileByPath(this.managedFolder);
    if (root instanceof TFolder) this.collect(root, documents);
    return { documents, settings };
  }

  watch(listener: (change: ProjectManagerSourceChange) => void): () => void {
    const index = this.index();
    if (typeof index?.onChange === "function") {
      // A project rename/config edit can change many task relationships at once.
      // Coalesce native index events and resolve a consistent snapshot after it updates.
      let active = true;
      let queued = false;
      const stop = index.onChange(() => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (active) listener({ kind: "reconcile" });
        });
      });
      return () => { active = false; stop(); };
    }
    const metadataRef = this.app.metadataCache.on("changed", (file, _data, cache) => {
      if (!this.isManaged(file.path)) return;
      listener({ kind: "upsert", document: this.document(file, cache) });
    });
    const createRef = this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md" || !this.isManaged(file.path)) {
        return;
      }
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache) listener({ kind: "upsert", document: this.document(file, cache) });
    });
    const deleteRef = this.app.vault.on("delete", (file) => {
      if (!this.isManaged(file.path)) return;
      listener({ kind: "remove", path: file.path, recursive: file instanceof TFolder });
    });
    const renameRef = this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFolder) {
        if (this.isManaged(oldPath) || this.isManaged(file.path)) listener({ kind: "reconcile" });
        return;
      }
      if (this.isManaged(oldPath)) {
        listener({ kind: "remove", path: oldPath });
      }
      if (!(file instanceof TFile) || file.extension !== "md" || !this.isManaged(file.path)) {
        return;
      }
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache) listener({ kind: "upsert", document: this.document(file, cache) });
    });

    return () => {
      this.app.metadataCache.offref(metadataRef);
      this.app.vault.offref(createRef);
      this.app.vault.offref(deleteRef);
      this.app.vault.offref(renameRef);
    };
  }

  private collect(folder: TFolder, documents: ProjectManagerDocument[]): void {
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        this.collect(child, documents);
      } else if (child instanceof TFile && child.extension === "md") {
        documents.push(this.document(child, this.app.metadataCache.getFileCache(child)));
      }
    }
  }

  private document(file: TFile, cache: CachedMetadata | null): ProjectManagerDocument {
    const raw = frontmatter(cache);
    const normalized = raw && (raw["pm-task"] === true || raw["pm-task"] === "true")
      ? {
        ...raw,
        projectId: this.referenceId(raw.projectId, file.path),
        parentId: this.referenceId(raw.parentId, file.path)
      }
      : raw;
    return {
      path: file.path,
      basename: file.basename,
      frontmatter: normalized
    };
  }

  private referenceId(value: unknown, sourcePath: string): unknown {
    if (typeof value !== "string") return value;
    const link = /^\[\[([^\]]+)\]\]$/u.exec(value.trim())?.[1];
    if (!link) return value;
    const linkpath = link.split("|")[0]?.trim();
    if (!linkpath) return value;
    const target = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    const id: unknown = target ? this.app.metadataCache.getFileCache(target)?.frontmatter?.id : null;
    return typeof id === "string" && id.trim() ? id : value;
  }

  private index(): ProjectManagerIndex | null {
    const plugins = (this.app as App & {
      plugins?: { getPlugin(id: string): { index?: ProjectManagerIndex } | null };
    }).plugins;
    const index = plugins?.getPlugin("project-manager")?.index;
    return typeof index?.projectRefs === "function" && typeof index.allTaskRefs === "function"
      ? index
      : null;
  }

  private isManaged(path: string): boolean {
    return path === this.managedFolder || path.startsWith(`${this.managedFolder}/`);
  }

  private async readSettings(): Promise<Record<string, unknown> | null> {
    const path = `${this.app.vault.configDir}/plugins/project-manager/data.json`;
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null;
      const parsed: unknown = JSON.parse(await this.app.vault.adapter.read(path));
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      // Project Manager settings are optional compatibility hints. The default
      // folder, completion statuses and priorities remain available.
      return null;
    }
  }
}
