import { describe, expect, it } from "vitest";
import {
  aggregateMemberDashboard,
  memberDashboardTaskKey,
  memberDashboardWindowEnd
} from "../src/domain/member-dashboard";
import type { GateRiskSnapshot } from "../src/domain/gate-risk";
import type {
  MemberDashboardSettings,
  MemberInsight,
  TaskInsight,
  WorkMetrics
} from "../src/model";

function task(
  id: string,
  overrides: Partial<TaskInsight> = {}
): TaskInsight {
  const estimate = overrides.estimate ?? 8;
  const logged = overrides.logged ?? 0;
  const completed = overrides.completed ?? false;
  return {
    id,
    projectId: "p1",
    parentId: "root",
    hierarchy: "subtask",
    title: id,
    path: `Projects/${id}.md`,
    status: completed ? "done" : "todo",
    priority: "medium",
    tags: ["type/dev"],
    assignees: ["Ada"],
    estimate,
    logged,
    progress: completed ? 100 : 0,
    completed,
    archived: false,
    projectTitle: "Project one",
    resolvedAssignees: ["Ada"],
    assignmentKind: "personal",
    remaining: completed ? 0 : Math.max(estimate - logged, 0),
    overrun: Math.max(logged - estimate, 0),
    unestimated: estimate <= 0,
    ...overrides
  };
}

function metrics(): WorkMetrics {
  return {
    planned: 0,
    logged: 0,
    remaining: 0,
    overrun: 0,
    taskCount: 0,
    unestimatedCount: 0
  };
}

function member(name: string, tasks: TaskInsight[], kind: MemberInsight["kind"] = "member"):
MemberInsight {
  return {
    key: kind === "unassigned" ? "__unassigned__" : name.toLocaleLowerCase(),
    name,
    kind,
    personal: metrics(),
    shared: metrics(),
    ratios: {
      taskClosure: { numerator: 0, denominator: 0, percentage: null },
      plannedClosure: { numerator: 0, denominator: 0, percentage: null },
      timeConsumption: { numerator: 0, denominator: 0, percentage: null },
      overrunTasks: { numerator: 0, denominator: 0, percentage: null },
      estimateAccuracy: { numerator: 0, denominator: 0, percentage: null },
      estimateCoverage: { numerator: 0, denominator: 0, percentage: null }
    },
    tasks
  };
}

function riskSnapshot(stageTasks: TaskInsight[] = []): GateRiskSnapshot {
  const project = { id: "p1", title: "Project one", path: "Projects/P1.md", icon: "📋" };
  const common = {
    windowStart: "2026-08-31",
    progress: 0,
    expectedProgress: 0,
    progressGap: 0,
    progressSignal: "scheduled" as const,
    daysRemaining: 3,
    state: "normal" as const,
    skipped: false,
    reasons: [],
    blockingTasks: [],
    quality: { missingDue: 0, unestimated: 0, unassigned: 0 },
    timing: null,
    dueDateChecksEnabled: true,
    includeWeekends: false
  };
  return {
    today: "2026-08-31",
    projects: [{
      project,
      configured: true,
      state: "normal",
      nearestGate: null,
      gates: [
        {
          ...common,
          id: "development",
          name: "Development",
          kind: "stage",
          gateDate: "2026-09-03",
          tasks: stageTasks
        },
        {
          ...common,
          id: "launch",
          name: "",
          kind: "launch",
          gateDate: "2026-09-10",
          tasks: stageTasks
        }
      ]
    }],
    counts: { unconfigured: 0, normal: 1, attention: 0, high: 0, overdue: 0, passed: 0 },
    nearestGate: null
  };
}

const settings: MemberDashboardSettings = {
  windowMode: "7",
  customEndDate: "",
  includeWeekends: false
};

describe("member dashboard", () => {
  it("resolves preset and custom windows against the selected calendar", () => {
    expect(memberDashboardWindowEnd("2026-08-31", settings)).toBe("2026-09-09");
    expect(memberDashboardWindowEnd("2026-08-31", {
      ...settings,
      includeWeekends: true
    })).toBe("2026-09-07");
    expect(memberDashboardWindowEnd("2026-08-31", {
      ...settings,
      windowMode: "custom",
      customEndDate: "2026-09-18"
    })).toBe("2026-09-18");
  });

  it("keeps the delivery ledger scoped to all member tasks when past work leaves the planning window", () => {
    const completed = task("completed-before-window", {
      dueDate: "2026-08-28",
      estimate: 8,
      logged: 7,
      completed: true
    });
    const ada = member("Ada", [completed]);
    ada.ratios = {
      taskClosure: { numerator: 1, denominator: 1, percentage: 100 },
      plannedClosure: { numerator: 8, denominator: 8, percentage: 100 },
      timeConsumption: { numerator: 7, denominator: 8, percentage: 87.5 },
      overrunTasks: { numerator: 0, denominator: 1, percentage: 0 },
      estimateAccuracy: { numerator: 1, denominator: 1, percentage: 100 },
      estimateCoverage: { numerator: 1, denominator: 1, percentage: 100 }
    };

    const snapshot = aggregateMemberDashboard([ada], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      gateRisk: riskSnapshot([completed]),
      highPriorityIds: new Set()
    });

    expect(snapshot.members[0]).toMatchObject({
      windowTaskCount: 0,
      committedHours: 0,
      ratios: ada.ratios,
      windowRatios: {
        taskClosure: { numerator: 0, denominator: 0, percentage: null },
        plannedClosure: { numerator: 0, denominator: 0, percentage: null }
      }
    });
    expect(snapshot.comparison).toMatchObject({
      ledgerTaskClosurePercentage: 100,
      ledgerPlannedClosurePercentage: 100,
      ledgerTimeConsumptionPercentage: 87.5,
      ledgerOverrunPercentage: 0,
      ledgerEstimateAccuracyPercentage: 100,
      ledgerEstimateCoveragePercentage: 100
    });
  });

  it("splits shared work and catches an overloaded intermediate deadline", () => {
    const personal = task("personal", { dueDate: "2026-09-02", estimate: 16, remaining: 16 });
    const shared = task("shared", {
      dueDate: "2026-09-02",
      estimate: 8,
      remaining: 8,
      assignees: ["Ada", "Bao"],
      resolvedAssignees: ["Ada", "Bao"],
      assignmentKind: "shared"
    });
    const snapshot = aggregateMemberDashboard([member("Ada", [personal, shared])], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      gateRisk: riskSnapshot([personal, shared]),
      highPriorityIds: new Set(["critical", "high"])
    });
    const ada = snapshot.members[0];

    expect(ada?.committedHours).toBe(20);
    expect(ada?.availableHours).toBe(56);
    expect(ada?.loadPercentage).toBeCloseTo(35.71);
    expect(ada?.checkpoints[0]).toMatchObject({
      date: "2026-09-02",
      remainingHours: 20,
      availableHours: 16,
      state: "high"
    });
    expect(ada?.health).toBe("high");
  });

  it("falls back from task dates to stage and launch gates without inventing a deadline", () => {
    const staged = task("staged", { dueDate: null });
    const launchOnly = task("launch-only", { dueDate: null, tags: ["type/unknown"] });
    const unknown = task("unknown", { projectId: "p2", dueDate: null });
    const snapshot = aggregateMemberDashboard([
      member("Ada", [staged, launchOnly, unknown])
    ], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      gateRisk: riskSnapshot([staged]),
      highPriorityIds: new Set()
    });
    const byKey = new Map(snapshot.members[0]?.tasks.map((metric) => [metric.key, metric]));

    expect(byKey.get(memberDashboardTaskKey(staged))).toMatchObject({
      effectiveDeadline: "2026-09-03",
      deadlineSource: "stage"
    });
    expect(byKey.get(memberDashboardTaskKey(launchOnly))).toMatchObject({
      effectiveDeadline: "2026-09-10",
      deadlineSource: "launch"
    });
    expect(byKey.get(memberDashboardTaskKey(unknown))).toMatchObject({
      effectiveDeadline: null,
      deadlineSource: "unknown"
    });
    expect(snapshot.members[0]?.health).toBe("attention");
    expect(snapshot.members[0]?.unscheduledTaskCount).toBe(1);
  });

  it("reports unconfigured gate projects only when they contain the member's work", () => {
    const adaTask = task("ada-unconfigured");
    const baoTask = task("bao-configured", {
      projectId: "p2",
      projectTitle: "Project two",
      assignees: ["Bao"],
      resolvedAssignees: ["Bao"]
    });
    const risk = riskSnapshot();
    const firstProject = risk.projects[0];
    if (!firstProject) throw new Error("Expected the risk fixture to include p1");
    firstProject.configured = false;
    firstProject.state = "unconfigured";
    firstProject.gates = [];
    risk.projects.push({
      project: { id: "p2", title: "Project two", path: "Projects/P2.md", icon: "📋" },
      configured: true,
      state: "normal",
      gates: [],
      nearestGate: null
    });

    const snapshot = aggregateMemberDashboard([
      member("Ada", [adaTask]),
      member("Bao", [baoTask])
    ], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      gateRisk: risk,
      highPriorityIds: new Set()
    });

    expect(snapshot.members.find((item) => item.memberName === "Ada")
      ?.unconfiguredProjectIds).toEqual(["p1"]);
    expect(snapshot.members.find((item) => item.memberName === "Bao")
      ?.unconfiguredProjectIds).toEqual([]);
  });

  it("attributes a task planned after its stage gate without pulling its hours into the window", () => {
    const afterGate = task("after-gate", {
      dueDate: "2026-09-10",
      estimate: 12,
      remaining: 12
    });
    const snapshot = aggregateMemberDashboard([member("Ada", [afterGate])], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      gateRisk: riskSnapshot([afterGate]),
      highPriorityIds: new Set()
    });

    expect(snapshot.members[0]?.committedHours).toBe(0);
    expect(snapshot.members[0]?.laterHours).toBe(12);
    expect(snapshot.members[0]?.health).toBe("high");
    expect(snapshot.members[0]?.drivers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "gate", state: "high", taskCount: 1 })
    ]));
  });

  it("raises an attention blind spot without guessing hours for unestimated work", () => {
    const unestimated = task("unestimated", {
      dueDate: "2026-09-02",
      estimate: 0,
      remaining: 0,
      unestimated: true
    });
    const archived = task("archived", {
      dueDate: "2026-09-02",
      estimate: 80,
      remaining: 80,
      archived: true
    });
    const cancelled = task("cancelled", {
      dueDate: "2026-09-02",
      estimate: 80,
      remaining: 0,
      status: "cancelled",
      completed: true
    });
    const snapshot = aggregateMemberDashboard([
      member("Ada", [unestimated, archived, cancelled])
    ], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      gateRisk: riskSnapshot([unestimated, archived, cancelled]),
      highPriorityIds: new Set()
    });

    expect(snapshot.members[0]).toMatchObject({
      health: "attention",
      committedHours: 0,
      unestimatedTaskCount: 1,
      windowTaskCount: 1
    });
    expect(snapshot.members[0]?.tasks).toHaveLength(1);
  });

  it("always calculates peer medians while excluding unassigned work", () => {
    const adaTask = task("ada", { dueDate: "2026-09-03", estimate: 8, remaining: 8 });
    const baoTask = task("bao", {
      dueDate: "2026-09-03",
      estimate: 16,
      remaining: 16,
      assignees: ["Bao"],
      resolvedAssignees: ["Bao"]
    });
    const unassignedTask = task("unassigned", {
      dueDate: "2026-09-03",
      estimate: 64,
      remaining: 64,
      assignees: [],
      resolvedAssignees: [],
      assignmentKind: "unassigned"
    });
    const snapshot = aggregateMemberDashboard([
      member("Ada", [adaTask]),
      member("Bao", [baoTask]),
      member("Unassigned", [unassignedTask], "unassigned")
    ], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      gateRisk: riskSnapshot([adaTask, baoTask, unassignedTask]),
      highPriorityIds: new Set()
    });

    expect(snapshot.comparison.sampleSize).toBe(2);
    expect(snapshot.comparison.loadPercentage).toBeCloseTo(21.43);
    expect(snapshot.members).toHaveLength(2);
  });
});
