import { describe, expect, it } from "vitest";
import {
  aggregateGateRisk,
  gateRiskSummaryState,
  gateTaskRiskSignals
} from "../src/domain/gate-risk";
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
  launchDate: "2026-08-18",
  includeWeekends: true
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

describe("gateRiskSummaryState", () => {
  const counts = {
    unconfigured: 0,
    normal: 0,
    attention: 0,
    high: 0,
    overdue: 0,
    passed: 0
  };

  it.each([
    [{ ...counts, passed: 2 }, "normal"],
    [{ ...counts, unconfigured: 1 }, "unconfigured"],
    [{ ...counts, unconfigured: 1, attention: 1 }, "attention"],
    [{ ...counts, attention: 1, high: 1 }, "high"],
    [{ ...counts, high: 1, overdue: 1 }, "overdue"]
  ] as const)("returns the highest summary state for %o", (input, expected) => {
    expect(gateRiskSummaryState(input)).toBe(expected);
  });
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

  it("recalculates expected progress and remaining time with a workday-only project clock", () => {
    const workdaySchedule = { ...schedule, includeWeekends: false };
    const snapshot = risk([
      root(),
      task({ id: "done", completed: true, completedAt: "2026-08-06" }),
      task({ id: "open" })
    ], "2026-08-08", { p1: workdaySchedule });
    const stage = snapshot.projects[0]?.gates[0];

    expect(stage).toMatchObject({
      expectedProgress: 71.43,
      daysRemaining: 2,
      includeWeekends: false
    });
  });

  it("does not advance planned progress while a workday-only clock is on a weekend", () => {
    const workdaySchedule = { ...schedule, includeWeekends: false };
    const friday = risk([root(), task({ id: "open" })], "2026-08-07", {
      p1: workdaySchedule
    });
    const saturday = risk([root(), task({ id: "open" })], "2026-08-08", {
      p1: workdaySchedule
    });

    expect(friday.projects[0]?.gates[0]?.expectedProgress).toBe(71.43);
    expect(saturday.projects[0]?.gates[0]?.expectedProgress).toBe(71.43);
  });

  it("keeps a weekend-overdue gate overdue even when zero workdays have elapsed", () => {
    const weekendGate: ProjectGateSchedule = {
      ...schedule,
      startDate: "2026-08-03",
      stageGates: { delivery: "2026-08-07" },
      acceptanceGate: "2026-08-10",
      launchDate: "2026-08-11",
      includeWeekends: false
    };
    const stage = risk([root(), task({ id: "open" })], "2026-08-09", {
      p1: weekendGate
    }).projects[0]?.gates[0];

    expect(stage?.state).toBe("overdue");
    expect(Math.abs(stage?.daysRemaining ?? 1)).toBe(0);
  });

  it("reports task-to-gate differences in workdays when weekends are excluded", () => {
    const candidate = task({ id: "weekend-plan", dueDate: "2026-08-15" });
    const workdaySchedule = { ...schedule, includeWeekends: false };
    const gate = risk([root(), candidate], "2026-08-08", { p1: workdaySchedule })
      .projects[0]?.gates[0];
    if (!gate) throw new Error("Missing delivery gate");

    expect(gateTaskRiskSignals(candidate, gate, "2026-08-08"))
      .toContainEqual({ kind: "task-after-gate", days: 3 });
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

  it("ignores every task due-date signal when users disable due-date checks", () => {
    const late = task({ id: "late-plan", dueDate: "2026-08-12" });
    const undated = task({ id: "undated", dueDate: null });
    const snapshot = aggregateGateRisk([project], [root(), late, undated], {
      projectIds: new Set(["p1"]),
      includeArchived: false,
      settings,
      gateSchedules: { p1: schedule },
      today: "2026-08-01",
      checkTaskDueDates: false
    });
    const stage = snapshot.projects[0]?.gates[0];
    if (!stage) throw new Error("Missing delivery gate");

    expect(stage).toMatchObject({
      state: "normal",
      reasons: [],
      quality: { missingDue: 0 },
      dueDateChecksEnabled: false
    });
    expect(gateTaskRiskSignals(late, stage, "2026-08-01"))
      .not.toContainEqual(expect.objectContaining({ kind: "task-after-gate" }));
    expect(gateTaskRiskSignals(undated, stage, "2026-08-01"))
      .not.toContainEqual({ kind: "missing-due" });
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

  it("describes each task's direct schedule and planning risks", () => {
    const candidate = task({
      id: "multi-risk",
      dueDate: "2026-08-12",
      estimate: 0,
      assignees: []
    });
    const gate = risk([root(), candidate], "2026-08-08").projects[0]?.gates[0];
    if (!gate) throw new Error("Missing delivery gate");

    expect(gateTaskRiskSignals(candidate, gate, "2026-08-08")).toEqual([
      { kind: "task-after-gate", days: 1 },
      { kind: "unestimated" },
      { kind: "unassigned" }
    ]);
  });

  it("distinguishes acceptance blockers from requirement estimates", () => {
    const requirement = root({ estimate: 0 });
    const blocker = task({ id: "blocked" });
    const acceptance = risk([requirement, blocker], "2026-08-12")
      .projects[0]?.gates.find((gate) => gate.id === "acceptance");
    if (!acceptance) throw new Error("Missing acceptance gate");

    expect(gateTaskRiskSignals(requirement, acceptance, "2026-08-12"))
      .toContainEqual({ kind: "awaiting-acceptance" });
    expect(gateTaskRiskSignals(requirement, acceptance, "2026-08-12"))
      .not.toContainEqual({ kind: "unestimated" });
    expect(gateTaskRiskSignals(blocker, acceptance, "2026-08-12", true))
      .toContainEqual({ kind: "acceptance-blocker" });
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

  it("assesses the launch reminder across the full project timeline and all stages", () => {
    const projectSettings: DeliveryProgressSettings = {
      ...settings,
      stages: [
        { ...settings.stages[0]!, id: "development", tags: ["type/development"], weight: 50 },
        { ...settings.stages[0]!, id: "testing", tags: ["type/testing"], weight: 40 }
      ]
    };
    const projectSchedule: ProjectGateSchedule = {
      startDate: "2026-08-01",
      stageGates: {
        development: "2026-08-05",
        testing: "2026-08-10"
      },
      acceptanceGate: "2026-08-15",
      launchDate: "2026-08-21",
      includeWeekends: true
    };
    const snapshot = aggregateGateRisk([project], [
      root(),
      task({
        id: "development-done",
        tags: ["type/development"],
        completed: true,
        completedAt: "2026-08-04"
      }),
      task({
        id: "testing-done",
        tags: ["type/testing"],
        completed: true,
        completedAt: "2026-08-09"
      }),
      task({ id: "testing-open", tags: ["type/testing"], dueDate: "2026-08-20" })
    ], {
      projectIds: new Set(["p1"]),
      includeArchived: false,
      settings: projectSettings,
      gateSchedules: { p1: projectSchedule },
      today: "2026-08-11"
    });
    const launch = snapshot.projects[0]?.gates.find((gate) => gate.id === "launch");

    expect(launch).toMatchObject({
      windowStart: "2026-08-01",
      progress: 70,
      expectedProgress: 50,
      progressGap: 0,
      state: "normal"
    });
    expect(launch?.tasks.map((candidate) => candidate.id).sort()).toEqual([
      "root",
      "testing-open"
    ]);
  });

  it("keeps acceptance as the launch standard while exposing optional unfinished work", () => {
    const projectSettings: DeliveryProgressSettings = {
      ...settings,
      stages: [
        {
          ...settings.stages[0]!,
          id: "discovery",
          tags: ["type/discovery"],
          weight: 10,
          acceptancePrerequisite: false
        },
        { ...settings.stages[0]!, id: "delivery", weight: 80 }
      ]
    };
    const projectSchedule: ProjectGateSchedule = {
      startDate: "2026-08-01",
      stageGates: { discovery: "2026-08-05", delivery: "2026-08-10" },
      acceptanceGate: "2026-08-15",
      launchDate: "2026-08-21",
      includeWeekends: true
    };
    const snapshot = aggregateGateRisk([project], [
      root({ completed: true, completedAt: "2026-08-14" }),
      task({ id: "discovery-open", tags: ["type/discovery"], dueDate: "2026-08-20" }),
      task({
        id: "delivery-done",
        completed: true,
        completedAt: "2026-08-14"
      })
    ], {
      projectIds: new Set(["p1"]),
      includeArchived: false,
      settings: projectSettings,
      gateSchedules: { p1: projectSchedule },
      today: "2026-08-16"
    });
    const launch = snapshot.projects[0]?.gates.find((gate) => gate.id === "launch");

    expect(launch).toMatchObject({ state: "passed", progress: 90, timing: "early" });
    expect(launch?.tasks.map((candidate) => candidate.id)).toEqual(["discovery-open"]);
  });
});
