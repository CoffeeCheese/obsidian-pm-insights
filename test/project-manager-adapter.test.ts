import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({}));

import { ProjectManagerAdapter } from "../src/adapters/project-manager";

function appWithTasks(frontmatters: Record<string, unknown>[]): ConstructorParameters<
  typeof ProjectManagerAdapter
>[0] {
  const files = frontmatters.map((_, index) => ({
    path: `Tasks/task-${index}.md`,
    basename: `task-${index}`
  }));

  return {
    vault: {
      configDir: "test-config",
      getMarkdownFiles: () => files,
      adapter: {
        exists: async () => false
      }
    },
    metadataCache: {
      getFileCache: (file: { path: string }) => ({
        frontmatter: frontmatters[Number(file.path.match(/task-(\d+)/)?.[1])]
      })
    }
  } as unknown as ConstructorParameters<typeof ProjectManagerAdapter>[0];
}

describe("ProjectManagerAdapter", () => {
  it("normalizes Project Manager task types into hierarchy levels", async () => {
    const adapter = new ProjectManagerAdapter(
      appWithTasks([
        { "pm-task": true, id: "root", projectId: "p1", type: "task" },
        { "pm-task": true, id: "leaf", projectId: "p1", type: "subtask" },
        { "pm-task": true, id: "legacy", projectId: "p1" }
      ])
    );

    const snapshot = await adapter.read();

    expect(snapshot.tasks.map(({ id, hierarchy }) => ({ id, hierarchy }))).toEqual([
      { id: "root", hierarchy: "root" },
      { id: "leaf", hierarchy: "subtask" },
      { id: "legacy", hierarchy: "unknown" }
    ]);
  });
});
