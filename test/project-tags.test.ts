import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/model";
import { collectProjectTagOptions } from "../src/domain/project-tags";

function task(id: string, tags: string[]): TaskRecord {
  return {
    id,
    projectId: "project-1",
    parentId: null,
    hierarchy: "root",
    title: id,
    path: `${id}.md`,
    status: "todo",
    priority: null,
    tags,
    assignees: [],
    estimate: 0,
    logged: 0,
    progress: 0,
    completed: false,
    archived: false
  };
}

describe("collectProjectTagOptions", () => {
  it("normalizes tags, counts each task once, and sorts by usage", () => {
    const result = collectProjectTagOptions([
      task("one", ["#Type/Dev", "type/dev", "release/v1"]),
      task("two", ["type/dev", "type/test"]),
      task("three", ["type/test"])
    ]);

    expect(result).toEqual([
      { tag: "type/dev", taskCount: 2 },
      { tag: "type/test", taskCount: 2 },
      { tag: "release/v1", taskCount: 1 }
    ]);
  });
});
