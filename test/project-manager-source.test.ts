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
