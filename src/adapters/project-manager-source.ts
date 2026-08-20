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
    const root = this.app.vault.getAbstractFileByPath(this.managedFolder);
    if (root instanceof TFolder) this.collect(root, documents);
    return { documents, settings };
  }

  watch(listener: (change: ProjectManagerSourceChange) => void): () => void {
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
    return {
      path: file.path,
      basename: file.basename,
      frontmatter: frontmatter(cache)
    };
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
