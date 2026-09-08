import { describe, expect, it, vi } from "vitest";

const obsidianMocks = vi.hoisted(() => {
  class MockTFile {
    path: string;
    basename: string;
    extension: string;

    constructor(path: string) {
      this.path = path;
      const name = path.split("/").at(-1) ?? path;
      this.basename = name.replace(/\.[^.]+$/u, "");
      this.extension = name.includes(".") ? name.split(".").at(-1) ?? "" : "";
    }
  }

  class MockTFolder {
    constructor(
      public path: string,
      public children: Array<MockTFile | MockTFolder>
    ) {}
  }

  return { MockTFile, MockTFolder };
});

vi.mock("obsidian", () => ({
  normalizePath: (path: string) => path.replace(/^\/+|\/+$/gu, ""),
  TFile: obsidianMocks.MockTFile,
  TFolder: obsidianMocks.MockTFolder
}));

import type { App } from "obsidian";
import { ObsidianProjectManagerSource } from "../src/adapters/project-manager-source";
import { ProjectManagerCatalog } from "../src/adapters/project-manager";

function indexedFixture() {
  const projectPath = "Elsewhere/Demo/Demo.md";
  const rootPath = "Elsewhere/Demo/_tasks/Root.md";
  const childPath = "Elsewhere/Demo/_tasks/Child.md";
  const caches = new Map<string, { frontmatter: Record<string, unknown> }>([
    [projectPath, { frontmatter: { "pm-project": true, id: "p1" } }],
    [rootPath, { frontmatter: {
      "pm-task": true, id: "root", projectId: "[[Demo|Demo project]]", type: "task"
    } }],
    [childPath, { frontmatter: {
      "pm-task": true, id: "child", projectId: "[[Demo]]", parentId: "[[Root|Parent]]",
      type: "subtask", tags: ["type/sketch"], assignees: ["[[People/Alex|Alex]]"], status: "done"
    } }]
  ]);
  const refs = [
    { path: rootPath, id: "root", projectPath, archived: false },
    { path: childPath, id: "child", projectPath, archived: false }
  ];
  const files = new Map([...caches.keys()].map((path) => [path, new obsidianMocks.MockTFile(path)]));
  const handlers = new Set<() => void>();
  const stopIndex = vi.fn();
  const index = {
    ready: true,
    projectRefs: () => [{ path: projectPath, id: "p1" }],
    allTaskRefs: () => refs,
    completeStatuses: vi.fn(() => new Set(["done"])),
    onChange: (handler: () => void) => {
      handlers.add(handler);
      return () => { handlers.delete(handler); stopIndex(); };
    }
  };
  const getMarkdownFiles = vi.fn(() => { throw new Error("Do not rescan the whole vault"); });
  const getFirstLinkpathDest = vi.fn((link: string) =>
    [...files.values()].find((file) => file.basename === link || file.path === `${link}.md`) ?? null
  );
  const app = {
    plugins: { getPlugin: () => ({ index }) },
    vault: {
      configDir: "custom-config",
      adapter: { exists: async () => true, read: async () => '{"projectsFolder":"Projects"}' },
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles,
      on: vi.fn(), offref: vi.fn()
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => caches.get(file.path) ?? null,
      getFirstLinkpathDest,
      on: vi.fn(), offref: vi.fn()
    }
  } as unknown as App;
  return {
    app, index, refs, files, caches, projectPath, rootPath, childPath,
    getMarkdownFiles, getFirstLinkpathDest, stopIndex,
    emitIndex: () => handlers.forEach((handler) => handler())
  };
}

function fixture(): {
  app: App;
  getMarkdownFiles: ReturnType<typeof vi.fn>;
  getAbstractFileByPath: ReturnType<typeof vi.fn>;
  metadataOffref: ReturnType<typeof vi.fn>;
  vaultOffref: ReturnType<typeof vi.fn>;
  emitMetadata: (path: string, frontmatter: Record<string, unknown>) => void;
} {
  const managedProject = new obsidianMocks.MockTFile("Work/project.md");
  const managedTask = new obsidianMocks.MockTFile("Work/project_tasks/task.md");
  const root = new obsidianMocks.MockTFolder("Work", [
    managedProject,
    new obsidianMocks.MockTFolder("Work/project_tasks", [managedTask])
  ]);
  const caches = new Map([
    [managedProject.path, { frontmatter: { "pm-project": true, id: "p1" } }],
    [managedTask.path, { frontmatter: { "pm-task": true, id: "t1", projectId: "p1" } }]
  ]);
  const metadataListeners = new Set<(
    file: InstanceType<typeof obsidianMocks.MockTFile>,
    data: string,
    cache: { frontmatter: Record<string, unknown> }
  ) => void>();
  const getMarkdownFiles = vi.fn(() => {
    throw new Error("full Vault enumeration is forbidden");
  });
  const getAbstractFileByPath = vi.fn((path: string) => path === "Work" ? root : null);
  const metadataOffref = vi.fn();
  const vaultOffref = vi.fn();
  const app = {
    vault: {
      configDir: "custom-config",
      adapter: {
        exists: vi.fn(async () => true),
        read: vi.fn(async () => JSON.stringify({ projectsFolder: "Work" }))
      },
      getAbstractFileByPath,
      getMarkdownFiles,
      on: vi.fn(() => ({ id: Symbol("vault-event") })),
      offref: vaultOffref
    },
    metadataCache: {
      getFileCache: vi.fn((file: { path: string }) => caches.get(file.path) ?? null),
      on: vi.fn((name: string, listener: (...args: never[]) => void) => {
        if (name === "changed") {
          metadataListeners.add(listener as unknown as (
            file: InstanceType<typeof obsidianMocks.MockTFile>,
            data: string,
            cache: { frontmatter: Record<string, unknown> }
          ) => void);
        }
        return { id: Symbol("metadata-event") };
      }),
      offref: metadataOffref
    }
  } as unknown as App;

  return {
    app,
    getMarkdownFiles,
    getAbstractFileByPath,
    metadataOffref,
    vaultOffref,
    emitMetadata: (path, frontmatter) => {
      const file = new obsidianMocks.MockTFile(path);
      for (const listener of metadataListeners) listener(file, "", { frontmatter });
    }
  };
}

describe("ObsidianProjectManagerSource", () => {
  it("resolves wikilinks in folder-based discovery while preserving bare and unresolved IDs", async () => {
    const f = indexedFixture();
    const plugins = f.app as App & { plugins: { getPlugin: () => null } };
    plugins.plugins.getPlugin = () => null;
    const root = new obsidianMocks.MockTFolder("Projects", [...f.files.values()]);
    const lookup = f.app.vault.getAbstractFileByPath.bind(f.app.vault);
    f.app.vault.getAbstractFileByPath = ((path: string) =>
      path === "Projects" ? root : lookup(path)
    ) as typeof lookup;
    const source = new ObsidianProjectManagerSource(f.app);

    const documents = (await source.scan()).documents;
    expect(documents.find((document) => document.path === f.childPath)?.frontmatter)
      .toMatchObject({ projectId: "p1", parentId: "root" });

    const child = f.caches.get(f.childPath)!;
    child.frontmatter.projectId = "legacy-id";
    child.frontmatter.parentId = "[[Missing|No parent]]";
    const next = (await source.scan()).documents;
    expect(next.find((document) => document.path === f.childPath)?.frontmatter)
      .toMatchObject({ projectId: "legacy-id", parentId: "[[Missing|No parent]]" });
  });

  it("discovers indexed projects outside the creation folder and resolves linked task relationships", async () => {
    const f = indexedFixture();
    const original = structuredClone([...f.caches]);
    const snapshot = await new ProjectManagerCatalog(new ObsidianProjectManagerSource(f.app)).snapshot();

    expect(snapshot.projects.map((project) => project.id)).toEqual(["p1"]);
    expect(snapshot.tasks.map(({ id, projectId, parentId }) => ({ id, projectId, parentId })))
      .toEqual([
        { id: "root", projectId: "p1", parentId: null },
        { id: "child", projectId: "p1", parentId: "root" }
      ]);
    expect(snapshot.tasks[1]?.assignees).toEqual(["[[People/Alex|Alex]]"]);
    expect(f.getFirstLinkpathDest).toHaveBeenCalledWith("Root", f.childPath);
    expect([...f.caches]).toEqual(original);
    expect(f.getMarkdownFiles).not.toHaveBeenCalled();
  });

  it("uses indexed ownership and archive state even when a task has no projectId or archived property", async () => {
    const f = indexedFixture();
    const cache = f.caches.get(f.childPath)!;
    delete cache.frontmatter.projectId;
    f.refs[1]!.archived = true;
    const snapshot = await new ProjectManagerCatalog(new ObsidianProjectManagerSource(f.app)).snapshot();

    expect(snapshot.tasks.find((task) => task.id === "child"))
      .toMatchObject({ projectId: "p1", archived: true });
  });

  it("honors project-specific completion overrides supplied by the native index", async () => {
    const f = indexedFixture();
    f.index.completeStatuses.mockReturnValue(new Set(["accepted"]));
    const snapshot = await new ProjectManagerCatalog(new ObsidianProjectManagerSource(f.app)).snapshot();

    expect(snapshot.tasks.find((task) => task.id === "child"))
      .toMatchObject({ status: "done", completed: false });
  });

  it("reconciles index changes, including initial readiness and exclusions, and unsubscribes", async () => {
    const f = indexedFixture();
    f.index.ready = false;
    const source = new ObsidianProjectManagerSource(f.app);
    expect((await source.scan()).documents).toEqual([]);
    const listener = vi.fn();
    const stop = source.watch(listener);
    f.index.ready = true;
    f.emitIndex();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith({ kind: "reconcile" });
    expect((await source.scan()).documents).toHaveLength(3);

    f.refs.pop();
    f.emitIndex();
    await Promise.resolve();
    expect((await source.scan()).documents.map((document) => document.path))
      .toEqual([f.projectPath, f.rootPath]);
    stop();
    listener.mockClear();
    f.emitIndex();
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
    expect(f.stopIndex).toHaveBeenCalledOnce();
  });

  it("recursively scans only the configured Project Manager folder", async () => {
    const { app, getAbstractFileByPath, getMarkdownFiles } = fixture();
    const source = new ObsidianProjectManagerSource(app);

    const snapshot = await source.scan();

    expect(snapshot.documents.map((document) => document.path)).toEqual([
      "Work/project.md",
      "Work/project_tasks/task.md"
    ]);
    expect(getMarkdownFiles).not.toHaveBeenCalled();
    expect(getAbstractFileByPath).toHaveBeenCalledWith("Work");
  });

  it("forwards managed metadata changes and ignores unrelated notes", async () => {
    const { app, emitMetadata, metadataOffref, vaultOffref } = fixture();
    const source = new ObsidianProjectManagerSource(app);
    await source.scan();
    const listener = vi.fn();
    const stop = source.watch(listener);

    emitMetadata("Notes/unrelated.md", { title: "Unrelated" });
    emitMetadata("Work/project_tasks/task.md", {
      "pm-task": true,
      id: "t1",
      projectId: "p1",
      status: "done"
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: "upsert" }));
    stop();
    expect(metadataOffref).toHaveBeenCalledTimes(1);
    expect(vaultOffref).toHaveBeenCalledTimes(3);
  });
});
