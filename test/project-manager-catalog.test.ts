import { describe, expect, it, vi } from "vitest";

import {
  ProjectManagerCatalog,
  type ProjectManagerDocument,
  type ProjectManagerSource,
  type ProjectManagerSourceChange,
  type ProjectManagerSourceSnapshot
} from "../src/adapters/project-manager";

function document(
  path: string,
  frontmatter: Record<string, unknown> | null
): ProjectManagerDocument {
  return {
    path,
    basename: path.split("/").at(-1)?.replace(/\.md$/u, "") ?? path,
    frontmatter
  };
}

class MemorySource implements ProjectManagerSource {
  scans = 0;
  snapshotValue: ProjectManagerSourceSnapshot;
  private readonly listeners = new Set<(change: ProjectManagerSourceChange) => void>();

  constructor(snapshot: ProjectManagerSourceSnapshot) {
    this.snapshotValue = snapshot;
  }

  async scan(): Promise<ProjectManagerSourceSnapshot> {
    this.scans += 1;
    return structuredClone(this.snapshotValue);
  }

  watch(listener: (change: ProjectManagerSourceChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change: ProjectManagerSourceChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

describe("ProjectManagerCatalog", () => {
  it("normalizes a managed snapshot once and serves cached reads", async () => {
    const source = new MemorySource({
      documents: [
        document("Projects/example.md", {
          "pm-project": true,
          id: "p1",
          title: "Example"
        }),
        document("Projects/example_tasks/root.md", {
          "pm-task": true,
          id: "root",
          projectId: "p1",
          type: "task",
          status: "shipped",
          priority: " urgent ",
          tags: [" launch ", "#release"],
          assignees: ["Alex"],
          timeEstimate: 8,
          timeLogs: [{ hours: 3 }]
        }),
        document("Projects/example_tasks/leaf.md", {
          "pm-task": "true",
          id: "leaf",
          projectId: "p1",
          parentId: "root",
          type: "subtask"
        })
      ],
      settings: {
        statuses: [{ id: "shipped", complete: true }],
        priorities: [{ id: "urgent", label: "Urgent", color: "#d45555" }]
      }
    });
    const catalog = new ProjectManagerCatalog(source);

    const first = await catalog.snapshot();
    const second = await catalog.snapshot();

    expect(source.scans).toBe(1);
    expect(second).toBe(first);
    expect(first.projects).toEqual([
      { id: "p1", title: "Example", path: "Projects/example.md", icon: "📋" }
    ]);
    expect(first.tasks.map(({ id, hierarchy, priority, tags, completed }) => ({
      id,
      hierarchy,
      priority,
      tags,
      completed
    }))).toEqual([
      {
        id: "root",
        hierarchy: "root",
        priority: "urgent",
        tags: ["launch", "release"],
        completed: true
      },
      { id: "leaf", hierarchy: "subtask", priority: null, tags: [], completed: false }
    ]);
    expect(first.priorities).toEqual([
      { id: "urgent", label: "Urgent", color: "#d45555" }
    ]);
  });

  it("updates one document without rescanning and ignores semantic no-ops", async () => {
    const taskPath = "Projects/example_tasks/task.md";
    const initial = document(taskPath, {
      "pm-task": true,
      id: "task",
      projectId: "p1",
      status: "todo"
    });
    const source = new MemorySource({ documents: [initial], settings: null });
    const catalog = new ProjectManagerCatalog(source);
    const listener = vi.fn();
    const unsubscribe = catalog.subscribe(listener);
    await catalog.snapshot();

    source.emit({ kind: "upsert", document: structuredClone(initial) });
    source.emit({
      kind: "upsert",
      document: document(taskPath, {
        ...initial.frontmatter,
        status: "in-progress",
        tags: "backend",
        timeEstimate: 5
      })
    });

    const updated = await catalog.snapshot();
    expect(source.scans).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(updated.tasks[0]).toMatchObject({
      status: "in-progress",
      tags: ["backend"],
      estimate: 5
    });

    source.emit({ kind: "remove", path: taskPath });
    expect((await catalog.snapshot()).tasks).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("reconciles configuration and preserves default compatibility values", async () => {
    const taskDocument = document("Projects/example_tasks/task.md", {
      "pm-task": true,
      id: "task",
      projectId: "p1",
      status: "accepted"
    });
    const source = new MemorySource({ documents: [taskDocument], settings: null });
    const catalog = new ProjectManagerCatalog(source);
    await catalog.snapshot();
    expect((await catalog.snapshot()).tasks[0]?.completed).toBe(false);

    source.snapshotValue = {
      documents: [taskDocument],
      settings: {
        statuses: [{ id: "accepted", complete: true }],
        priorities: []
      }
    };
    await catalog.reconcile();

    const reconciled = await catalog.snapshot();
    expect(source.scans).toBe(2);
    expect(reconciled.tasks[0]?.completed).toBe(true);
    expect(reconciled.priorities.map((priority) => priority.id)).toEqual([
      "critical",
      "high",
      "medium",
      "low"
    ]);
  });

  it("replays changes that arrive during lazy initialization", async () => {
    let release: ((snapshot: ProjectManagerSourceSnapshot) => void) | undefined;
    const listeners = new Set<(change: ProjectManagerSourceChange) => void>();
    const source: ProjectManagerSource = {
      scan: () => new Promise((resolve) => {
        release = resolve;
      }),
      watch: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    };
    const catalog = new ProjectManagerCatalog(source);
    catalog.subscribe(() => undefined);
    const pending = catalog.snapshot();
    for (const listener of listeners) {
      listener({
        kind: "upsert",
        document: document("Projects/example_tasks/new.md", {
          "pm-task": true,
          id: "new",
          projectId: "p1"
        })
      });
    }
    release?.({ documents: [], settings: null });

    expect((await pending).tasks.map((task) => task.id)).toEqual(["new"]);
  });
});
