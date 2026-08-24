import { describe, expect, it } from "vitest";
import {
  compareAcceptanceSchedule,
  compareStageSchedule
} from "../src/domain/delivery-schedule";
import type {
  AcceptanceProgressMetric,
  StageProgressMetric
} from "../src/domain/delivery-progress";
import type {
  GateRiskMetric,
  GateRiskSnapshot,
  ProjectGateRisk
} from "../src/domain/gate-risk";
import type { ProjectRecord, TaskRecord } from "../src/model";

function project(id: string): ProjectRecord {
  return { id, title: id.toUpperCase(), path: `Projects/${id}.md`, icon: "" };
}

function task(id: string, projectId: string, hierarchy: "root" | "subtask" = "subtask"): TaskRecord {
  return {
    id,
    projectId,
    parentId: hierarchy === "root" ? null : "root",
    hierarchy,
    title: id,
    path: `Tasks/${id}.md`,
    status: "todo",
    priority: null,
    tags: [],
    assignees: [],
    estimate: 0,
    logged: 0,
    progress: 0,
    completed: false,
    archived: false
  };
}

function gate(
  projectId: string,
  expectedProgress: number,
  kind: "stage" | "acceptance" = "stage"
): ProjectGateRisk {
  const id = kind === "acceptance" ? "acceptance" : "delivery";
  const metric: GateRiskMetric = {
    id,
    name: id,
    kind,
    windowStart: "2026-08-01",
    gateDate: "2026-08-31",
    progress: 0,
    expectedProgress,
    progressGap: expectedProgress,
    progressSignal: "scheduled",
    daysRemaining: 10,
    state: "normal",
    skipped: false,
    reasons: [],
    tasks: [],
    blockingTasks: [],
    quality: { missingDue: 0, unestimated: 0, unassigned: 0 },
    timing: null,
    dueDateChecksEnabled: true
  };
  return {
    project: project(projectId),
    configured: true,
    state: "normal",
    gates: [metric],
    nearestGate: metric
  };
}

function snapshot(projects: ProjectGateRisk[]): GateRiskSnapshot {
  return {
    today: "2026-08-21",
    projects,
    counts: {
      unconfigured: projects.filter((entry) => !entry.configured).length,
      normal: projects.filter((entry) => entry.configured).length,
      attention: 0,
      high: 0,
      overdue: 0,
      passed: 0
    },
    nearestGate: null
  };
}

describe("delivery schedule comparison", () => {
  it("weights each project's expected stage progress by its task count", () => {
    const metric: StageProgressMetric = {
      id: "delivery",
      name: "Delivery",
      completed: 2,
      total: 4,
      percentage: 50,
      state: "progress",
      weight: 90,
      tasks: [
        task("p1-task", "p1"),
        task("p2-task-1", "p2"),
        task("p2-task-2", "p2"),
        task("p2-task-3", "p2")
      ]
    };

    expect(compareStageSchedule(metric, snapshot([gate("p1", 20), gate("p2", 80)])))
      .toEqual({
        expectedPercentage: 65,
        variance: -15,
        state: "behind",
        relevantProjectCount: 2,
        configuredProjectCount: 2
      });
  });

  it("withholds a partial comparison when a relevant project has no gates", () => {
    const metric: StageProgressMetric = {
      id: "delivery",
      name: "Delivery",
      completed: 1,
      total: 2,
      percentage: 50,
      state: "progress",
      weight: 90,
      tasks: [task("p1-task", "p1"), task("p2-task", "p2")]
    };
    const unconfigured: ProjectGateRisk = {
      project: project("p2"),
      configured: false,
      state: "unconfigured",
      gates: [],
      nearestGate: null
    };

    expect(compareStageSchedule(metric, snapshot([gate("p1", 50), unconfigured])))
      .toEqual({
        expectedPercentage: null,
        variance: null,
        state: "unconfigured",
        relevantProjectCount: 2,
        configuredProjectCount: 1
      });
  });

  it("compares acceptance using root-task counts", () => {
    const roots = [task("root-1", "p1", "root"), task("root-2", "p2", "root")];
    const metric: AcceptanceProgressMetric = {
      accepted: 1,
      pending: 0,
      notReady: 1,
      total: 2,
      percentage: 50,
      weight: 10,
      roots: roots.map((rootTask, index) => ({
        task: rootTask,
        state: index === 0 ? "accepted" : "not-ready",
        prerequisites: [],
        blockers: []
      }))
    };

    expect(compareAcceptanceSchedule(
      metric,
      snapshot([gate("p1", 25, "acceptance"), gate("p2", 75, "acceptance")])
    )).toMatchObject({
      expectedPercentage: 50,
      variance: 0,
      state: "on-plan"
    });
  });

  it("reports unavailable when a stage has no comparable work", () => {
    const metric: StageProgressMetric = {
      id: "delivery",
      name: "Delivery",
      completed: 0,
      total: 0,
      percentage: null,
      state: "skipped",
      weight: 90,
      tasks: []
    };

    expect(compareStageSchedule(metric, snapshot([]))).toMatchObject({
      expectedPercentage: null,
      variance: null,
      state: "unavailable",
      relevantProjectCount: 0
    });
  });
});
