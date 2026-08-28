import { describe, expect, it } from "vitest";
import { assessLaunchCapacity } from "../src/domain/launch-capacity";
import type { TaskRecord } from "../src/model";

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    projectId: "p1",
    parentId: "root",
    hierarchy: "subtask",
    title: id,
    path: `Tasks/${id}.md`,
    status: "todo",
    priority: null,
    tags: [],
    assignees: ["Alex"],
    estimate: 8,
    logged: 2,
    progress: 25,
    completed: false,
    archived: false,
    ...overrides
  };
}

const input = (tasks: TaskRecord[]) => ({
  tasks,
  stages: [{
    id: "development",
    name: "Development",
    gateDate: "2026-08-06",
    tasks
  }],
  today: "2026-08-01",
  launchDate: "2026-08-06",
  includeWeekends: true,
  hoursPerDay: 8,
  aliases: [],
  passed: false
});

describe("assessLaunchCapacity", () => {
  it("uses the busiest owner's load instead of serializing parallel owners", () => {
    const metric = assessLaunchCapacity(input([
      task("alice", { assignees: ["Alice"], estimate: 60, logged: 0 }),
      task("bob", { assignees: ["Bob"], estimate: 50, logged: 0 })
    ]));

    expect(metric).toMatchObject({
      remainingHours: 110,
      bottleneckAssignee: "Alice",
      bottleneckHours: 60,
      availableHours: 40,
      balanceHours: -20,
      utilizationPercentage: 150,
      requiredDays: 7.5,
      state: "high"
    });
    expect(metric.checkpoints.at(-1)?.owners).toEqual([
      { name: "Alice", hours: 60 },
      { name: "Bob", hours: 50 }
    ]);
  });

  it("accumulates one owner's work across stage milestones", () => {
    const development = task("development", {
      assignees: ["Alex"],
      estimate: 30,
      logged: 0
    });
    const testing = task("testing", {
      assignees: ["Alex"],
      estimate: 50,
      logged: 0
    });
    const metric = assessLaunchCapacity({
      ...input([development, testing]),
      stages: [
        {
          id: "development",
          name: "Development",
          gateDate: "2026-08-05",
          tasks: [development]
        },
        {
          id: "testing",
          name: "Testing",
          gateDate: "2026-08-10",
          tasks: [testing]
        }
      ],
      launchDate: "2026-08-10"
    });

    expect(metric.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      owner: checkpoint.bottleneckAssignee,
      hours: checkpoint.bottleneckHours,
      available: checkpoint.availableHours
    }))).toEqual([
      { id: "development", owner: "Alex", hours: 30, available: 32 },
      { id: "testing", owner: "Alex", hours: 80, available: 72 },
      { id: "launch", owner: "Alex", hours: 80, available: 72 }
    ]);
    expect(metric).toMatchObject({ bottleneckHours: 80, balanceHours: -8, state: "high" });
  });

  it("keeps different stage owners parallel through launch", () => {
    const development = task("development", {
      assignees: ["Alex"],
      estimate: 20,
      logged: 0
    });
    const testing = task("testing", {
      assignees: ["Blair"],
      estimate: 50,
      logged: 0
    });
    const metric = assessLaunchCapacity({
      ...input([development, testing]),
      stages: [
        {
          id: "development",
          name: "Development",
          gateDate: "2026-08-05",
          tasks: [development]
        },
        {
          id: "testing",
          name: "Testing",
          gateDate: "2026-08-10",
          tasks: [testing]
        }
      ],
      launchDate: "2026-08-10"
    });

    expect(metric).toMatchObject({
      remainingHours: 70,
      bottleneckAssignee: "Blair",
      bottleneckHours: 50,
      availableHours: 72,
      balanceHours: 22,
      state: "normal"
    });
  });

  it("splits shared task effort and resolves aliases before grouping owners", () => {
    const metric = assessLaunchCapacity({
      ...input([
        task("shared", {
          assignees: ["A. Chen", "Blair"],
          estimate: 20,
          logged: 0
        }),
        task("personal", {
          assignees: ["Alex Chen"],
          estimate: 10,
          logged: 0
        })
      ]),
      aliases: [{ canonical: "Alex Chen", aliases: ["A. Chen"] }]
    });

    expect(metric).toMatchObject({
      remainingHours: 30,
      bottleneckAssignee: "Alex Chen",
      bottleneckHours: 20,
      sharedTaskCount: 1
    });
    expect(metric.checkpoints.at(-1)?.owners).toEqual([
      { name: "Alex Chen", hours: 20 },
      { name: "Blair", hours: 10 }
    ]);
  });

  it("surfaces unestimated, unassigned, and unmapped work as planning blind spots", () => {
    const mapped = task("mapped", { estimate: 8, logged: 0 });
    const unestimated = task("unknown", { estimate: 0, logged: 0 });
    const unassigned = task("unassigned", { assignees: [], estimate: 12, logged: 0 });
    const unmapped = task("unmapped", { estimate: 4, logged: 0 });
    const metric = assessLaunchCapacity({
      ...input([mapped, unestimated, unassigned, unmapped]),
      stages: [{
        id: "development",
        name: "Development",
        gateDate: "2026-08-06",
        tasks: [mapped, unestimated, unassigned]
      }]
    });

    expect(metric).toMatchObject({
      remainingHours: 24,
      unestimatedTaskCount: 1,
      unassignedTaskCount: 1,
      unassignedHours: 12,
      unmappedTaskCount: 1,
      state: "attention"
    });
  });

  it("deduplicates tasks and excludes completed, archived, and cancelled work", () => {
    const open = task("open", { estimate: 5, logged: 1 });
    const metric = assessLaunchCapacity(input([
      open,
      open,
      task("done", { completed: true, estimate: 20 }),
      task("archived", { archived: true, estimate: 20 }),
      task("cancelled", { status: "cancelled", estimate: 20 })
    ]));

    expect(metric).toMatchObject({
      remainingHours: 4,
      bottleneckHours: 4,
      state: "normal"
    });
  });
});
