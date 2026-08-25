import { describe, expect, it } from "vitest";
import {
  addScheduleDays,
  effectiveGateSchedule,
  forecastFromSchedule,
  forecastHasDelay,
  gateDelayDays,
  reconcileProjectGateActuals,
  validateGateForecast
} from "../src/domain/gate-delay";
import { DEFAULT_SETTINGS, type ProjectGateSchedule, type TaskRecord } from "../src/model";

const schedule: ProjectGateSchedule = {
  startDate: "2026-08-03",
  stageGates: {
    design: "2026-08-05",
    development: "2026-08-10",
    testing: "2026-08-12"
  },
  acceptanceGate: "2026-08-14",
  launchDate: "2026-08-17",
  includeWeekends: false
};

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task",
    projectId: "p1",
    parentId: "root",
    hierarchy: "subtask",
    title: "Task",
    path: "Projects/p1_tasks/task.md",
    status: "done",
    priority: null,
    tags: ["type/design"],
    assignees: ["A"],
    estimate: 1,
    logged: 1,
    progress: 100,
    completed: true,
    archived: false,
    ...overrides
  };
}

function root(): TaskRecord {
  return task({
    id: "root",
    parentId: null,
    hierarchy: "root",
    title: "Requirement",
    tags: [],
    status: "todo",
    completed: false,
    completedAt: null
  });
}

describe("gate delay planning", () => {
  it("keeps an evaluation separate from the effective confirmed schedule", () => {
    const evaluation = forecastFromSchedule(schedule);
    evaluation.launchDate = "2026-08-24";
    expect(effectiveGateSchedule(schedule, {
      status: "evaluating",
      draft: evaluation,
      revisions: []
    }).launchDate).toBe("2026-08-17");

    expect(effectiveGateSchedule(schedule, {
      status: "confirmed",
      confirmed: evaluation,
      revisions: []
    }).launchDate).toBe("2026-08-24");
    expect(gateDelayDays(schedule, evaluation, "launch")).toBe(5);
  });

  it("shifts linked gates on the shared project clock", () => {
    expect(addScheduleDays("2026-08-07", 1, false)).toBe("2026-08-10");
    expect(addScheduleDays("2026-08-10", -1, false)).toBe("2026-08-07");
    expect(addScheduleDays("2026-08-07", 1, true)).toBe("2026-08-08");
  });

  it("rejects forecast dates before the baseline or in the past", () => {
    const forecast = forecastFromSchedule(schedule);
    forecast.stageGates.design = "2026-08-04";
    forecast.launchDate = "2026-08-16";
    const result = validateGateForecast(
      schedule,
      forecast,
      DEFAULT_SETTINGS.deliveryProgress.stages.map((stage) => stage.id),
      undefined,
      "2026-08-06"
    );
    expect(result.valid).toBe(false);
    expect(result.beforeBaseline).toEqual(expect.arrayContaining(["design", "launch"]));
    expect(result.inPast).toContain("design");
  });

  it("does not keep a plan delayed only because a completed gate actually passed late", () => {
    const forecast = forecastFromSchedule(schedule);
    forecast.stageGates.design = "2026-08-08";
    expect(forecastHasDelay(schedule, forecast, ["design", "development", "testing"], {
      gates: {
        design: {
          date: "2026-08-08",
          source: "tasks",
          recordedAt: "2026-08-08T09:00:00.000Z",
          open: false
        }
      },
      events: []
    })).toBe(false);
  });
});

describe("automatic gate outcomes", () => {
  it("records reliable sequential pass dates and waits for upstream gates", () => {
    const settings = structuredClone(DEFAULT_SETTINGS.deliveryProgress);
    const tasks = [
      root(),
      task({ id: "design", tags: ["type/design"], completedAt: "2026-08-05" }),
      task({ id: "dev", tags: ["type/dev"], completedAt: "2026-08-08" }),
      task({ id: "test", tags: ["type/test"], completedAt: "2026-08-07" })
    ];
    const result = reconcileProjectGateActuals({
      projectId: "p1",
      tasks,
      settings,
      includeArchived: false,
      schedule,
      previous: undefined,
      today: "2026-08-10",
      now: "2026-08-10T09:00:00.000Z"
    });

    expect(result.changed).toBe(true);
    expect(result.state.gates.design).toMatchObject({ date: "2026-08-05", source: "tasks", open: false });
    expect(result.state.gates.development).toMatchObject({ date: "2026-08-08", source: "tasks", open: false });
    expect(result.state.gates.testing).toMatchObject({ date: "2026-08-08", source: "tasks", open: false });
  });

  it("uses an observation fallback, then records a reliable correction", () => {
    const settings = structuredClone(DEFAULT_SETTINGS.deliveryProgress);
    const withoutDate = [root(), task({ id: "design", tags: ["type/design"], completedAt: null })];
    const observed = reconcileProjectGateActuals({
      projectId: "p1",
      tasks: withoutDate,
      settings,
      includeArchived: false,
      schedule,
      previous: undefined,
      today: "2026-08-06",
      now: "2026-08-06T09:00:00.000Z"
    });
    expect(observed.state.gates.design).toMatchObject({ date: "2026-08-06", source: "observed" });

    const corrected = reconcileProjectGateActuals({
      projectId: "p1",
      tasks: [root(), task({ id: "design", tags: ["type/design"], completedAt: "2026-08-05" })],
      settings,
      includeArchived: false,
      schedule,
      previous: observed.state,
      today: "2026-08-07",
      now: "2026-08-07T09:00:00.000Z"
    });
    expect(corrected.state.gates.design).toMatchObject({ date: "2026-08-05", source: "tasks" });
    expect(corrected.state.events.at(-1)).toMatchObject({
      kind: "corrected",
      previousDate: "2026-08-06",
      date: "2026-08-05"
    });
  });

  it("reopens a passed gate when unfinished scoped work is added", () => {
    const settings = structuredClone(DEFAULT_SETTINGS.deliveryProgress);
    const passed = reconcileProjectGateActuals({
      projectId: "p1",
      tasks: [root(), task({ id: "design", tags: ["type/design"], completedAt: "2026-08-05" })],
      settings,
      includeArchived: false,
      schedule,
      previous: undefined,
      today: "2026-08-06",
      now: "2026-08-06T09:00:00.000Z"
    });
    const reopened = reconcileProjectGateActuals({
      projectId: "p1",
      tasks: [
        root(),
        task({ id: "design", tags: ["type/design"], completedAt: "2026-08-05" }),
        task({ id: "design-new", tags: ["type/design"], completed: false, completedAt: null })
      ],
      settings,
      includeArchived: false,
      schedule,
      previous: passed.state,
      today: "2026-08-07",
      now: "2026-08-07T09:00:00.000Z"
    });
    expect(reopened.state.gates.design?.open).toBe(true);
    expect(reopened.state.events.at(-1)?.kind).toBe("reopened");
  });
});
