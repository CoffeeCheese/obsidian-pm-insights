import { describe, expect, it } from "vitest";
import { aggregateGateRisk } from "../src/domain/gate-risk";
import type {
  DeliveryProgressSettings,
  ProjectGateSchedule,
  ProjectRecord,
  TaskRecord
} from "../src/model";

function task(overrides: Partial<TaskRecord> & Pick<TaskRecord, "id">): TaskRecord {
  const { id, ...rest } = overrides;
  return {
    id,
    projectId: "p1",
    parentId: "root",
    hierarchy: "subtask",
    title: overrides.id,
    path: `Tasks/${overrides.id}.md`,
    status: "todo",
    priority: null,
    tags: ["type/delivery"],
    assignees: ["Alex"],
    estimate: 4,
    logged: 0,
    progress: 0,
    completed: false,
    archived: false,
    dueDate: "2026-08-10",
    ...rest
  };
}

const root = (overrides: Partial<TaskRecord> = {}): TaskRecord => task({
  id: "root",
  parentId: null,
  hierarchy: "root",
  tags: [],
  dueDate: "2026-08-15",
  ...overrides
});

const project: ProjectRecord = { id: "p1", title: "Orbit", path: "Projects/Orbit.md", icon: "🛰️" };

const settings: DeliveryProgressSettings = {
  stages: [{
    id: "delivery",
    name: "Delivery",
    tags: ["type/delivery"],
    weight: 90,
    acceptancePrerequisite: true,
    skipWhenEmpty: false
  }],
  acceptanceWeight: 10,
  validateCompletedRootPrerequisites: true
};

const schedule: ProjectGateSchedule = {
  startDate: "2026-08-01",
  stageGates: { delivery: "2026-08-11" },
  acceptanceGate: "2026-08-15",
  launchDate: "2026-08-18"
};

const risk = (
  tasks: TaskRecord[],
  today = "2026-08-08",
  schedules: Record<string, ProjectGateSchedule> = { p1: schedule }
) => aggregateGateRisk([project], tasks, {
  projectIds: new Set(["p1"]),
  includeArchived: false,
  settings,
  gateSchedules: schedules,
  today
});

describe("aggregateGateRisk", () => {
  it("marks a stage attention when its shared completion ratio trails time by 20 points", () => {
    const snapshot = risk([
      root(),
      task({ id: "done", completed: true, completedAt: "2026-08-06" }),
      task({ id: "open" })
    ]);
    const stage = snapshot.projects[0]?.gates[0];

    expect(stage).toMatchObject({
      id: "delivery",
      state: "attention",
      progress: 50,
      expectedProgress: 70,
      progressGap: 20,
      daysRemaining: 3
    });
    expect(snapshot.nearestGate).toMatchObject({ project: { id: "p1" }, gate: { id: "delivery" } });
  });

  it("raises explicit unfinished task date conflicts to high risk", () => {
    const snapshot = risk([
      root(),
      task({ id: "late-plan", dueDate: "2026-08-12" })
    ], "2026-08-02");
    const stage = snapshot.projects[0]?.gates[0];

    expect(stage?.state).toBe("high");
    expect(stage?.reasons).toContain("task-after-gate");
  });

  it("marks an incomplete stage overdue only after its gate date", () => {
    expect(risk([root(), task({ id: "open" })], "2026-08-11").projects[0]?.gates[0]?.state)
      .toBe("high");
    const overdue = risk([root(), task({ id: "open" })], "2026-08-12");
    expect(overdue.projects[0]?.gates[0]?.state).toBe("overdue");
    expect(overdue.projects[0]?.nearestGate?.id).toBe("delivery");
  });

  it("preserves skipped stage semantics instead of inventing pass timing", () => {
    const skippedSettings = structuredClone(settings);
    const [delivery] = skippedSettings.stages;
    if (!delivery) throw new Error("Missing delivery stage");
    delivery.skipWhenEmpty = true;
    const snapshot = aggregateGateRisk([project], [root()], {
      projectIds: new Set(["p1"]),
      includeArchived: false,
      settings: skippedSettings,
      gateSchedules: { p1: schedule },
      today: "2026-08-12"
    });

    expect(snapshot.projects[0]?.gates[0]).toMatchObject({
      state: "passed",
      skipped: true,
      timing: null
    });
  });

  it("keeps business gates independent while acceptance exposes blocking root tasks", () => {
    const snapshot = risk([
      root(),
      task({ id: "done", completed: true, completedAt: "2026-08-10" })
    ], "2026-08-14");
    const [delivery, acceptance] = snapshot.projects[0]?.gates ?? [];

    expect(delivery?.state).toBe("passed");
    expect(acceptance).toMatchObject({ id: "acceptance", state: "high", progress: 0 });
    expect(acceptance?.tasks.map((candidate) => candidate.id)).toEqual(["root"]);
  });

  it("includes acceptance prerequisite tasks in risk and data-quality signals", () => {
    const snapshot = risk([
      root({ dueDate: "2026-08-15" }),
      task({ id: "blocked", dueDate: "2026-08-16", estimate: 0, assignees: [] })
    ], "2026-08-12");
    const acceptance = snapshot.projects[0]?.gates.find((gate) => gate.id === "acceptance");

    expect(acceptance?.state).toBe("high");
    expect(acceptance?.reasons).toContain("task-after-gate");
    expect(acceptance?.blockingTasks.map((candidate) => candidate.id)).toEqual(["blocked"]);
    expect(acceptance?.quality).toEqual({ missingDue: 0, unestimated: 1, unassigned: 1 });
  });

  it("requires estimates on delivery subtasks instead of requirement root tasks", () => {
    const snapshot = risk([
      root({ estimate: 0 }),
      task({ id: "estimated-work", estimate: 4 })
    ], "2026-08-12");
    const acceptance = snapshot.projects[0]?.gates.find((gate) => gate.id === "acceptance");

    expect(acceptance?.quality.unestimated).toBe(0);
  });

  it("still reports an unestimated delivery subtask beneath a requirement root", () => {
    const snapshot = risk([
      root({ estimate: 0 }),
      task({ id: "unestimated-work", estimate: 0 })
    ], "2026-08-12");
    const acceptance = snapshot.projects[0]?.gates.find((gate) => gate.id === "acceptance");

    expect(acceptance?.quality.unestimated).toBe(1);
  });

  it("reports incomplete schedules separately from risk", () => {
    const snapshot = risk([root(), task({ id: "open" })], "2026-08-08", {});
    expect(snapshot.projects[0]).toMatchObject({ configured: false, state: "unconfigured" });
    expect(snapshot.counts.unconfigured).toBe(1);
  });

  it("reports missing task planning data without raising an otherwise normal stage", () => {
    const snapshot = risk([
      root(),
      task({ id: "unplanned", dueDate: null, estimate: 0, assignees: [] })
    ], "2026-08-01");
    const stage = snapshot.projects[0]?.gates[0];

    expect(stage?.state).toBe("normal");
    expect(stage?.quality).toEqual({ missingDue: 1, unestimated: 1, unassigned: 1 });
  });

  it("describes work before its planned window as ahead instead of not started", () => {
    const futureSchedule: ProjectGateSchedule = {
      ...schedule,
      startDate: "2026-08-10",
      stageGates: { delivery: "2026-08-15" }
    };
    const snapshot = risk([
      root(),
      task({ id: "done", completed: true, completedAt: "2026-08-07" }),
      task({ id: "open" })
    ], "2026-08-08", { p1: futureSchedule });

    expect(snapshot.projects[0]?.gates[0]).toMatchObject({
      state: "normal",
      progress: 50,
      expectedProgress: 0,
      progressSignal: "ahead"
    });
  });

  it("marks later work as cross-stage progress while an earlier gate remains incomplete", () => {
    const multiStageSettings: DeliveryProgressSettings = {
      ...settings,
      stages: [
        { ...settings.stages[0]!, id: "development", tags: ["type/development"], weight: 50 },
        { ...settings.stages[0]!, id: "testing", tags: ["type/testing"], weight: 40 }
      ]
    };
    const multiStageSchedule: ProjectGateSchedule = {
      ...schedule,
      stageGates: {
        development: "2026-08-11",
        testing: "2026-08-15"
      }
    };
    const snapshot = aggregateGateRisk([project], [
      root(),
      task({ id: "development-open", tags: ["type/development"] }),
      task({
        id: "testing-done",
        tags: ["type/testing"],
        completed: true,
        completedAt: "2026-08-07"
      }),
      task({ id: "testing-open", tags: ["type/testing"] })
    ], {
      projectIds: new Set(["p1"]),
      includeArchived: false,
      settings: multiStageSettings,
      gateSchedules: { p1: multiStageSchedule },
      today: "2026-08-08"
    });

    expect(snapshot.projects[0]?.gates[1]).toMatchObject({
      state: "normal",
      progress: 50,
      expectedProgress: 0,
      progressSignal: "parallel"
    });
  });

  it("keeps pass timing as the primary signal after cross-stage work is completed", () => {
    const multiStageSettings: DeliveryProgressSettings = {
      ...settings,
      stages: [
        { ...settings.stages[0]!, id: "development", tags: ["type/development"], weight: 50 },
        { ...settings.stages[0]!, id: "testing", tags: ["type/testing"], weight: 40 }
      ]
    };
    const multiStageSchedule: ProjectGateSchedule = {
      ...schedule,
      stageGates: {
        development: "2026-08-11",
        testing: "2026-08-15"
      }
    };
    const snapshot = aggregateGateRisk([project], [
      root(),
      task({ id: "development-open", tags: ["type/development"] }),
      task({
        id: "testing-done",
        tags: ["type/testing"],
        completed: true,
        completedAt: "2026-08-07"
      })
    ], {
      projectIds: new Set(["p1"]),
      includeArchived: false,
      settings: multiStageSettings,
      gateSchedules: { p1: multiStageSchedule },
      today: "2026-08-08"
    });

    expect(snapshot.projects[0]?.gates[1]).toMatchObject({
      state: "passed",
      progressSignal: "scheduled",
      timing: "early"
    });
  });
});
