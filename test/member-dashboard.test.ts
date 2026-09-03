import { describe, expect, it } from "vitest";
import {
  aggregateMemberDashboard,
  memberDashboardTaskKey,
  memberDashboardWindowEnd
} from "../src/domain/member-dashboard";
import type { GateRiskSnapshot } from "../src/domain/gate-risk";
import { DEFAULT_SETTINGS } from "../src/model";
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

function riskSnapshot(
  stageTasks: TaskInsight[] = [],
  testingTasks: TaskInsight[] = []
): GateRiskSnapshot {
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
    includeWeekends: false,
    countSameDayGateAsDay: false
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
          id: "testing",
          name: "Testing",
          kind: "stage",
          gateDate: "2026-09-08",
          tasks: testingTasks
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

const deliveryDependencies = {
  deliveryProgressSettings: DEFAULT_SETTINGS.deliveryProgress,
  includeArchived: false
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
      ...deliveryDependencies,
      gateRisk: riskSnapshot([completed]),
      allTasks: [completed],
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
    const personal = task("personal", { dueDate: "2026-09-02", estimate: 24, remaining: 24 });
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
      ...deliveryDependencies,
      gateRisk: riskSnapshot([personal, shared]),
      allTasks: [personal, shared],
      highPriorityIds: new Set(["critical", "high"])
    });
    const ada = snapshot.members[0];

    expect(ada?.committedHours).toBe(28);
    expect(ada?.availableHours).toBe(56);
    expect(ada?.loadPercentage).toBe(50);
    expect(ada?.checkpoints[0]).toMatchObject({
      date: "2026-09-03",
      remainingHours: 28,
      availableHours: 24,
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
      ...deliveryDependencies,
      gateRisk: riskSnapshot([staged]),
      allTasks: [staged, launchOnly, unknown],
      highPriorityIds: new Set()
    });
    const byKey = new Map(snapshot.members[0]?.tasks.map((metric) => [metric.key, metric]));

    expect(byKey.get(memberDashboardTaskKey(staged))).toMatchObject({
      effectiveDeadline: "2026-09-03",
      deadlineSource: "stage"
    });
    expect(byKey.get(memberDashboardTaskKey(launchOnly))).toMatchObject({
      effectiveDeadline: null,
      deadlineSource: "unknown"
    });
    expect(byKey.get(memberDashboardTaskKey(unknown))).toMatchObject({
      effectiveDeadline: null,
      deadlineSource: "unknown"
    });
    expect(snapshot.members[0]?.health).toBe("attention");
    expect(snapshot.members[0]?.unscheduledTaskCount).toBe(2);
  });

  it("uses the farthest stage for a member whose project work crosses stages", () => {
    const development = task("development", { dueDate: "2026-09-04" });
    const testing = task("testing", { dueDate: "2026-09-04" });
    const snapshot = aggregateMemberDashboard([
      member("Ada", [development, testing])
    ], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      ...deliveryDependencies,
      gateRisk: riskSnapshot([development], [testing]),
      allTasks: [development, testing],
      highPriorityIds: new Set()
    });

    expect(snapshot.members[0]?.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: memberDashboardTaskKey(development),
        effectiveDeadline: "2026-09-08",
        deadlineSource: "stage"
      }),
      expect.objectContaining({
        key: memberDashboardTaskKey(testing),
        effectiveDeadline: "2026-09-08",
        deadlineSource: "stage"
      })
    ]));
    expect(snapshot.members[0]?.checkpoints).toEqual([
      expect.objectContaining({
        date: "2026-09-08",
        dueTaskCount: 2,
        taskKeys: [
          memberDashboardTaskKey(development),
          memberDashboardTaskKey(testing)
        ]
      })
    ]);
    expect(snapshot.members[0]?.drivers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "gate", state: "high", taskCount: 1 })
    ]));
  });

  it("keeps farthest-stage commitments independent across projects", () => {
    const projectOne = task("project-one-testing", { dueDate: null });
    const projectTwo = task("project-two-development", {
      projectId: "p2",
      projectTitle: "Project two",
      dueDate: null
    });
    const risk = riskSnapshot([], [projectOne]);
    const projectTwoRisk = structuredClone(risk.projects[0]);
    if (!projectTwoRisk) throw new Error("Expected the risk fixture to include p1");
    projectTwoRisk.project = {
      id: "p2",
      title: "Project two",
      path: "Projects/P2.md",
      icon: "📋"
    };
    for (const gate of projectTwoRisk.gates) {
      gate.tasks = gate.id === "development" ? [projectTwo] : [];
      if (gate.id === "development") gate.gateDate = "2026-09-05";
      if (gate.id === "testing") gate.gateDate = "2026-09-09";
      if (gate.id === "launch") gate.gateDate = "2026-09-12";
    }
    risk.projects.push(projectTwoRisk);

    const snapshot = aggregateMemberDashboard([
      member("Ada", [projectOne, projectTwo])
    ], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      ...deliveryDependencies,
      gateRisk: risk,
      allTasks: [projectOne, projectTwo],
      highPriorityIds: new Set()
    });
    const byKey = new Map(snapshot.members[0]?.tasks.map((metric) => [metric.key, metric]));

    expect(byKey.get(memberDashboardTaskKey(projectOne))?.effectiveDeadline)
      .toBe("2026-09-08");
    expect(byKey.get(memberDashboardTaskKey(projectTwo))?.effectiveDeadline)
      .toBe("2026-09-05");
  });

  it("resolves a parent commitment from the farthest stage of its descendants", () => {
    const parent = task("root", {
      parentId: null,
      hierarchy: "root",
      dueDate: "2026-09-10",
      tags: []
    });
    const development = task("development", { parentId: "root" });
    const testing = task("testing", { parentId: "root" });
    const snapshot = aggregateMemberDashboard([member("Ada", [parent])], {
      today: "2026-08-31",
      settings,
      workdayHours: 8,
      calendarDayHours: 8,
      ...deliveryDependencies,
      gateRisk: riskSnapshot([development], [testing]),
      allTasks: [parent, development, testing],
      highPriorityIds: new Set()
    });

    expect(snapshot.members[0]?.tasks[0]).toMatchObject({
      key: memberDashboardTaskKey(parent),
      effectiveDeadline: "2026-09-08",
      deadlineSource: "stage"
    });
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
      ...deliveryDependencies,
      gateRisk: risk,
      allTasks: [adaTask, baoTask],
      highPriorityIds: new Set()
    });

    expect(snapshot.members.find((item) => item.memberName === "Ada")
      ?.unconfiguredProjectIds).toEqual(["p1"]);
    expect(snapshot.members.find((item) => item.memberName === "Bao")
      ?.unconfiguredProjectIds).toEqual([]);
  });

  it("places work at its stage gate while preserving a later task-date risk", () => {
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
      ...deliveryDependencies,
      gateRisk: riskSnapshot([afterGate]),
      allTasks: [afterGate],
      highPriorityIds: new Set()
    });

    expect(snapshot.members[0]?.committedHours).toBe(12);
    expect(snapshot.members[0]?.laterHours).toBe(0);
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
      ...deliveryDependencies,
      gateRisk: riskSnapshot([unestimated, archived, cancelled]),
      allTasks: [unestimated, archived, cancelled],
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
      ...deliveryDependencies,
      gateRisk: riskSnapshot([adaTask, baoTask, unassignedTask]),
      allTasks: [adaTask, baoTask, unassignedTask],
      highPriorityIds: new Set()
    });

    expect(snapshot.comparison.sampleSize).toBe(2);
    expect(snapshot.comparison.loadPercentage).toBeCloseTo(21.43);
    expect(snapshot.members).toHaveLength(2);
  });
});
