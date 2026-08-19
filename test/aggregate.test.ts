import { describe, expect, it } from "vitest";
import { aggregateInsights, UNASSIGNED_KEY } from "../src/domain/aggregate";
import type { ProjectRecord, TaskRecord } from "../src/model";

const projects: ProjectRecord[] = [
  { id: "p1", title: "Alpha", path: "Projects/Alpha.md", icon: "📋" },
  { id: "p2", title: "Beta", path: "Projects/Beta.md", icon: "📋" }
];

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, "id">): TaskRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    projectId: "p1",
    parentId: null,
    hierarchy: "subtask",
    title: overrides.id,
    path: `Tasks/${overrides.id}.md`,
    status: "todo",
    assignees: ["Alice"],
    estimate: 0,
    logged: 0,
    progress: 0,
    completed: false,
    archived: false,
    ...rest
  };
}

const options = {
  projectIds: new Set(["p1", "p2"]),
  includeArchived: false,
  aliases: [{ canonical: "Alice", aliases: ["ALICE ", "Alice（frontend）"] }],
  unassignedLabel: "Unassigned"
};

describe("aggregateInsights", () => {
  it("keeps personal and shared work separate without duplicating the team total", () => {
    const snapshot = aggregateInsights(
      projects,
      [
        task({ id: "personal", estimate: 8, logged: 5, assignees: ["Alice"] }),
        task({ id: "shared", estimate: 6, logged: 2, assignees: ["Alice", "Bob"] })
      ],
      options
    );

    const alice = snapshot.members.find((member) => member.name === "Alice");
    const bob = snapshot.members.find((member) => member.name === "Bob");

    expect(alice?.personal).toMatchObject({ planned: 8, logged: 5, remaining: 3 });
    expect(alice?.shared).toMatchObject({ planned: 6, logged: 2, remaining: 4 });
    expect(bob?.personal.taskCount).toBe(0);
    expect(bob?.shared.remaining).toBe(4);
    expect(snapshot.team).toMatchObject({ planned: 14, logged: 7, remaining: 7 });
  });

  it("excludes parent tasks and reports parent hours instead of double counting", () => {
    const snapshot = aggregateInsights(
      projects,
      [
        task({ id: "parent", hierarchy: "unknown", estimate: 10, logged: 1 }),
        task({ id: "child-a", parentId: "parent", estimate: 4, logged: 2 }),
        task({ id: "child-b", parentId: "parent", estimate: 6, logged: 1 })
      ],
      options
    );

    expect(snapshot.team).toMatchObject({ planned: 10, logged: 3, remaining: 7 });
    expect(snapshot.quality).toMatchObject({ excludedParentCount: 1, excludedParentHours: 11 });
  });

  it("excludes explicit root tasks even when they do not have subtasks", () => {
    const snapshot = aggregateInsights(
      projects,
      [
        task({ id: "root-without-subtasks", hierarchy: "root", assignees: ["Alice"] }),
        task({ id: "leaf", hierarchy: "subtask", assignees: ["Bob"], estimate: 3 })
      ],
      options
    );

    expect(snapshot.members.find((member) => member.name === "Alice")).toBeUndefined();
    expect(snapshot.members.find((member) => member.name === "Bob")?.tasks).toHaveLength(1);
    expect(snapshot.team.taskCount).toBe(1);
    expect(snapshot.quality.subtaskCount).toBe(1);
    expect(snapshot.quality.excludedParentCount).toBe(1);
  });

  it("does not call unestimated logged work an overrun", () => {
    const snapshot = aggregateInsights(
      projects,
      [task({ id: "unestimated", estimate: 0, logged: 3 })],
      options
    );

    expect(snapshot.team).toMatchObject({ planned: 0, logged: 3, remaining: 0, overrun: 0 });
    expect(snapshot.quality.unestimatedCount).toBe(1);
  });

  it("gives completed and archived tasks no remaining hours", () => {
    const snapshot = aggregateInsights(
      projects,
      [
        task({ id: "done", estimate: 8, logged: 3, completed: true }),
        task({ id: "archived", estimate: 5, logged: 1, archived: true })
      ],
      { ...options, includeArchived: true }
    );

    expect(snapshot.team).toMatchObject({ planned: 13, logged: 4, remaining: 0 });
  });

  it("groups empty assignees and resolves aliases before deciding shared work", () => {
    const snapshot = aggregateInsights(
      projects,
      [
        task({ id: "none", assignees: [], estimate: 3 }),
        task({ id: "aliases", assignees: ["Alice", "Alice（frontend）"], estimate: 2 })
      ],
      options
    );

    expect(snapshot.members.find((member) => member.key === UNASSIGNED_KEY)?.personal.planned).toBe(3);
    expect(snapshot.members.find((member) => member.name === "Alice")?.personal.planned).toBe(2);
    expect(snapshot.members.find((member) => member.name === "Alice")?.shared.taskCount).toBe(0);
  });

  it("builds a six-metric member ratio profile from eligible task data", () => {
    const snapshot = aggregateInsights(
      projects,
      [
        task({ id: "accurate-done", estimate: 10, logged: 9, completed: true }),
        task({ id: "overrun-done", estimate: 5, logged: 7, completed: true }),
        task({ id: "active", estimate: 5, logged: 2 }),
        task({ id: "unestimated" }),
        task({
          id: "cancelled",
          status: "cancelled",
          estimate: 100,
          logged: 100,
          completed: true
        })
      ],
      options
    );

    expect(snapshot.members[0]?.ratios).toEqual({
      taskClosure: { numerator: 2, denominator: 4, percentage: 50 },
      plannedClosure: { numerator: 15, denominator: 20, percentage: 75 },
      timeConsumption: { numerator: 18, denominator: 20, percentage: 90 },
      overrunTasks: { numerator: 1, denominator: 3, percentage: 33.33 },
      estimateAccuracy: { numerator: 1, denominator: 2, percentage: 50 },
      estimateCoverage: { numerator: 3, denominator: 4, percentage: 75 }
    });
  });

  it("leaves ratios without a valid sample unavailable instead of reporting zero", () => {
    const snapshot = aggregateInsights(projects, [task({ id: "unestimated" })], options);

    expect(snapshot.members[0]?.ratios).toMatchObject({
      taskClosure: { numerator: 0, denominator: 1, percentage: 0 },
      plannedClosure: { numerator: 0, denominator: 0, percentage: null },
      timeConsumption: { numerator: 0, denominator: 0, percentage: null },
      overrunTasks: { numerator: 0, denominator: 0, percentage: null },
      estimateAccuracy: { numerator: 0, denominator: 0, percentage: null },
      estimateCoverage: { numerator: 0, denominator: 1, percentage: 0 }
    });
  });
});
