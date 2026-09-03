import { describe, expect, it } from "vitest";
import { buildPersonalDashboards } from "../src/domain/personal-delivery-dashboard";
import type { GateRiskSnapshot, ProjectGateRisk } from "../src/domain/gate-risk";
import { DEFAULT_SETTINGS } from "../src/model";
import type {
  MemberDashboardSettings,
  MemberInsight,
  TaskInsight,
  WorkMetrics
} from "../src/model";

function task(id: string, overrides: Partial<TaskInsight> = {}): TaskInsight {
  const estimate = overrides.estimate ?? 8;
  const logged = overrides.logged ?? 0;
  const completed = overrides.completed ?? false;
  return {
    id,
    projectId: "p1",
    parentId: null,
    hierarchy: "root",
    title: id,
    path: `Projects/${id}.md`,
    status: completed ? "done" : "todo",
    priority: "medium",
    tags: [],
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

function member(
  name: string,
  tasks: TaskInsight[],
  kind: MemberInsight["kind"] = "member"
): MemberInsight {
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

function riskProject(input: {
  id: string;
  title: string;
  development?: TaskInsight[];
  testing?: TaskInsight[];
  developmentDate?: string;
  testingDate?: string;
  countSameDayGateAsDay?: boolean;
  configured?: boolean;
}): ProjectGateRisk {
  const developmentDate = input.developmentDate ?? "2026-09-03";
  const testingDate = input.testingDate ?? "2026-09-08";
  const project = {
    id: input.id,
    title: input.title,
    path: `Projects/${input.id}.md`,
    icon: "📋"
  };
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
    countSameDayGateAsDay: input.countSameDayGateAsDay ?? false
  };
  const configured = input.configured ?? true;
  return {
    project,
    configured,
    state: configured ? "normal" : "unconfigured",
    nearestGate: null,
    gates: configured ? [
      {
        ...common,
        windowStart: common.windowStart,
        id: "development",
        name: "Development",
        kind: "stage",
        gateDate: developmentDate,
        tasks: input.development ?? []
      },
      {
        ...common,
        windowStart: developmentDate,
        id: "testing",
        name: "Testing",
        kind: "stage",
        gateDate: testingDate,
        tasks: input.testing ?? []
      }
    ] : []
  };
}

function riskSnapshot(
  projects: ProjectGateRisk[],
  today = "2026-08-31"
): GateRiskSnapshot {
  return {
    today,
    projects,
    counts: {
      unconfigured: projects.filter((project) => !project.configured).length,
      normal: projects.filter((project) => project.configured).length,
      attention: 0,
      high: 0,
      overdue: 0,
      passed: 0
    },
    nearestGate: null
  };
}

const settings: MemberDashboardSettings = {
  windowMode: "7",
  customEndDate: "",
  includeWeekends: false
};

function build(
  members: MemberInsight[],
  projects: ProjectGateRisk[],
  allTasks?: TaskInsight[],
  dashboardSettings: MemberDashboardSettings = settings,
  today = "2026-08-31"
) {
  return buildPersonalDashboards({
    members,
    today,
    settings: dashboardSettings,
    workdayHours: 8,
    calendarDayHours: 8,
    gateRisk: riskSnapshot(projects, today),
    allTasks: allTasks ?? members.flatMap((item) => item.tasks),
    deliveryProgressSettings: DEFAULT_SETTINGS.deliveryProgress,
    includeArchived: false,
    highPriorityIds: new Set(["critical", "high"])
  });
}

describe("personal delivery dashboard", () => {
  it("groups project commitments that share one delivery date", () => {
    const first = task("first", {
      completed: true,
      status: "done",
      logged: 8,
      remaining: 0,
      progress: 100
    });
    const second = task("second", {
      projectId: "p2",
      projectTitle: "Project two"
    });
    const catalog = build(
      [member("Ada", [first, second])],
      [
        riskProject({ id: "p1", title: "Project one", development: [first] }),
        riskProject({ id: "p2", title: "Project two", development: [second] })
      ]
    );

    expect(catalog.dashboards[0]?.deliveryWindows).toEqual([
      expect.objectContaining({
        date: "2026-09-03",
        commitments: [
          expect.objectContaining({ projectTitle: "Project one", stageName: "Development" }),
          expect.objectContaining({ projectTitle: "Project two", stageName: "Development" })
        ],
        remainingHours: 8,
        progress: {
          completedPlannedHours: 8,
          totalPlannedHours: 16,
          percentage: 50,
          completedTaskCount: 1,
          taskCount: 2
        }
      })
    ]);
  });

  it("keeps completed work in window progress when gate risk only exposes open tasks", () => {
    const root = task("root", {
      parentId: null,
      hierarchy: "root",
      tags: []
    });
    const completed = task("completed", {
      parentId: "root",
      hierarchy: "subtask",
      tags: ["type/dev"],
      completed: true,
      status: "done",
      logged: 8,
      remaining: 0,
      progress: 100
    });
    const open = task("open", {
      parentId: "root",
      hierarchy: "subtask",
      tags: ["type/dev"]
    });
    const catalog = build(
      [member("Ada", [completed, open])],
      [riskProject({ id: "p1", title: "Project one", development: [open] })],
      [root, completed, open]
    );

    expect(catalog.dashboards[0]?.deliveryWindows).toEqual([
      expect.objectContaining({
        date: "2026-09-03",
        commitments: [expect.objectContaining({ taskCount: 2 })],
        progress: {
          completedPlannedHours: 8,
          totalPlannedHours: 16,
          percentage: 50,
          completedTaskCount: 1,
          taskCount: 2
        }
      })
    ]);
  });

  it("places cross-stage work in the member's farthest project stage", () => {
    const development = task("development");
    const testing = task("testing");
    const catalog = build(
      [member("Ada", [development, testing])],
      [riskProject({ id: "p1", title: "Project one", development: [development], testing: [testing] })]
    );

    expect(catalog.dashboards[0]?.deliveryWindows).toEqual([
      expect.objectContaining({
        date: "2026-09-08",
        commitments: [expect.objectContaining({ stageName: "Testing", taskCount: 2 })]
      })
    ]);
  });

  it("splits shared work and compares cumulative load with intermediate capacity", () => {
    const early = task("early");
    const shared = task("shared", {
      projectId: "p2",
      projectTitle: "Project two",
      estimate: 16,
      remaining: 16,
      assignees: ["Ada", "Bao"],
      resolvedAssignees: ["Ada", "Bao"],
      assignmentKind: "shared"
    });
    const catalog = build(
      [member("Ada", [early, shared])],
      [
        riskProject({ id: "p1", title: "Project one", development: [early] }),
        riskProject({ id: "p2", title: "Project two", testing: [shared] })
      ]
    );
    const windows = catalog.dashboards[0]?.deliveryWindows;

    expect(windows?.[0]).toMatchObject({
      date: "2026-09-03",
      remainingHours: 8,
      cumulativeRemainingHours: 8,
      cumulativeCapacityHours: 24
    });
    expect(windows?.[1]).toMatchObject({
      date: "2026-09-08",
      remainingHours: 8,
      cumulativeRemainingHours: 16,
      cumulativeCapacityHours: 48
    });
  });

  it("keeps project workload independent from the delivery-window range", () => {
    const near = task("near", { estimate: 8, remaining: 8 });
    const laterShared = task("later-shared", {
      projectId: "p2",
      projectTitle: "Project two",
      estimate: 24,
      remaining: 24,
      assignees: ["Ada", "Bao"],
      resolvedAssignees: ["Ada", "Bao"],
      assignmentKind: "shared"
    });
    const unestimated = task("unestimated", {
      projectId: "p3",
      projectTitle: "Project three",
      estimate: 0,
      remaining: 0,
      unestimated: true
    });
    const members = [member("Ada", [near, laterShared, unestimated])];
    const projects = [
      riskProject({ id: "p1", title: "Project one", development: [near] }),
      riskProject({
        id: "p2",
        title: "Project two",
        development: [laterShared],
        developmentDate: "2026-09-25"
      }),
      riskProject({ id: "p3", title: "Project three" })
    ];

    const sevenDays = build(members, projects).dashboards[0];
    const thirtyDays = build(members, projects, undefined, {
      ...settings,
      windowMode: "30"
    }).dashboards[0];

    expect(sevenDays?.workload).toEqual(thirtyDays?.workload);
    expect(sevenDays?.capacity).toEqual(thirtyDays?.capacity);
    expect(sevenDays?.deliveryWindows).toHaveLength(1);
    expect(thirtyDays?.deliveryWindows).toHaveLength(2);
    expect(sevenDays?.capacity.checkpoints.map((checkpoint) => checkpoint.date)).toEqual([
      "2026-09-03",
      "2026-09-25"
    ]);
    expect(sevenDays?.workload).toMatchObject({
      totalRemainingHours: 20,
      openTaskCount: 3,
      unestimatedTaskCount: 1,
      projects: [
        {
          projectId: "p2",
          remainingHours: 12,
          sharePercentage: 60,
          openTaskCount: 1,
          delivery: {
            resolution: "resolved",
            stageName: "Development",
            date: "2026-09-25"
          }
        },
        {
          projectId: "p1",
          remainingHours: 8,
          sharePercentage: 40,
          openTaskCount: 1
        },
        {
          projectId: "p3",
          remainingHours: 0,
          sharePercentage: null,
          openTaskCount: 1,
          unestimatedTaskCount: 1,
          delivery: { resolution: "unresolved" }
        }
      ]
    });
  });

  it("compares cumulative project load with capacity at each delivery date", () => {
    const early = task("early", { estimate: 12, remaining: 12 });
    const later = task("later", {
      projectId: "p2",
      projectTitle: "Project two",
      estimate: 16,
      remaining: 16
    });
    const dashboard = build(
      [member("Ada", [early, later])],
      [
        riskProject({
          id: "p1",
          title: "Project one",
          development: [early],
          developmentDate: "2026-09-01"
        }),
        riskProject({
          id: "p2",
          title: "Project two",
          development: [later],
          developmentDate: "2026-09-03"
        })
      ]
    ).dashboards[0];

    expect(dashboard?.capacity).toMatchObject({
      state: "high",
      constrainedWindowCount: 2,
      uncertainProjectCount: 0,
      unscheduledRemainingHours: 0,
      criticalCheckpoint: {
        date: "2026-09-01",
        cumulativeRemainingHours: 12,
        availableHours: 8,
        balanceHours: -4,
        state: "high"
      },
      checkpoints: [
        {
          date: "2026-09-01",
          dueRemainingHours: 12,
          cumulativeRemainingHours: 12,
          availableHours: 8,
          balanceHours: -4,
          taskKeys: ["p1\u0000early"]
        },
        {
          date: "2026-09-03",
          dueRemainingHours: 16,
          cumulativeRemainingHours: 28,
          availableHours: 24,
          balanceHours: -4,
          taskKeys: ["p1\u0000early", "p2\u0000later"]
        }
      ]
    });
  });

  it("measures a stage delivery capacity from the previous stage gate", () => {
    const testing = task("testing", { estimate: 72, remaining: 72 });
    const dashboard = build(
      [member("Ada", [testing])],
      [riskProject({
        id: "p1",
        title: "Project one",
        testing: [testing],
        developmentDate: "2026-09-01",
        testingDate: "2026-09-07"
      })],
      undefined,
      settings,
      "2026-09-03"
    ).dashboards[0];

    expect(dashboard?.capacity.criticalCheckpoint).toMatchObject({
      windowStartDate: "2026-09-01",
      date: "2026-09-07",
      windowDays: 4,
      cumulativeRemainingHours: 72,
      availableHours: 32,
      balanceHours: -40
    });
    expect(dashboard?.deliveryWindows[0]).toMatchObject({
      date: "2026-09-07",
      cumulativeRemainingHours: 72,
      cumulativeCapacityHours: 32,
      balanceHours: -40
    });
  });

  it("applies the project same-day gate rule to delivery capacity", () => {
    const testing = task("testing", { estimate: 8, remaining: 8 });
    const dashboard = build(
      [member("Ada", [testing])],
      [riskProject({
        id: "p1",
        title: "Project one",
        testing: [testing],
        developmentDate: "2026-09-08",
        testingDate: "2026-09-08",
        countSameDayGateAsDay: true
      })],
      undefined,
      settings,
      "2026-09-03"
    ).dashboards[0];

    expect(dashboard?.capacity.criticalCheckpoint).toMatchObject({
      windowStartDate: "2026-09-08",
      date: "2026-09-08",
      windowDays: 1,
      cumulativeRemainingHours: 8,
      availableHours: 8,
      balanceHours: 0
    });
    expect(dashboard?.deliveryWindows[0]).toMatchObject({
      date: "2026-09-08",
      cumulativeCapacityHours: 8,
      balanceHours: 0
    });
  });

  it("excludes completed, archived, and cancelled work from project workload", () => {
    const active = task("active", { estimate: 8, remaining: 8 });
    const completed = task("completed", {
      completed: true,
      status: "done",
      estimate: 40,
      remaining: 40
    });
    const archived = task("archived", {
      archived: true,
      estimate: 40,
      remaining: 40
    });
    const cancelled = task("cancelled", {
      status: "cancelled",
      estimate: 40,
      remaining: 40
    });
    const unestimated = task("unestimated", {
      projectId: "p2",
      projectTitle: "Project two",
      estimate: 0,
      remaining: 0,
      unestimated: true
    });
    const dashboard = build(
      [member("Ada", [active, completed, archived, cancelled, unestimated])],
      [
        riskProject({
          id: "p1",
          title: "Project one",
          development: [active, completed, archived, cancelled]
        }),
        riskProject({ id: "p2", title: "Project two" })
      ]
    ).dashboards[0];

    expect(dashboard?.workload).toMatchObject({
      totalRemainingHours: 8,
      openTaskCount: 2,
      unestimatedTaskCount: 1,
      taskKeys: ["p1\u0000active", "p2\u0000unestimated"],
      projects: [
        { projectId: "p1", remainingHours: 8, sharePercentage: 100 },
        { projectId: "p2", remainingHours: 0, sharePercentage: null }
      ]
    });
  });

  it("uses a later task due date as risk without moving the delivery window", () => {
    const late = task("late", { dueDate: "2026-09-10" });
    const catalog = build(
      [member("Ada", [late])],
      [riskProject({ id: "p1", title: "Project one", development: [late] })]
    );
    const dashboard = catalog.dashboards[0];

    expect(dashboard?.deliveryWindows[0]?.date).toBe("2026-09-03");
    expect(dashboard?.deliveryWindows[0]?.signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "due-after-stage", taskCount: 1 })
    ]));
  });

  it("reports planning blind spots and excludes unassigned work from personal capacity", () => {
    const risky = task("risky", { dueDate: "2026-09-10" });
    const clean = task("clean", {
      assignees: ["Bao"],
      resolvedAssignees: ["Bao"]
    });
    const blind = task("blind", {
      estimate: 0,
      remaining: 0,
      unestimated: true,
      tags: ["type/unknown"]
    });
    const unassigned = task("unassigned", {
      assignees: [],
      resolvedAssignees: [],
      assignmentKind: "unassigned",
      dueDate: "2026-09-10"
    });
    const catalog = build(
      [
        member("Ada", [risky, blind]),
        member("Bao", [clean]),
        member("Unassigned", [unassigned], "unassigned")
      ],
      [riskProject({
        id: "p1",
        title: "Project one",
        development: [risky, clean, unassigned]
      })]
    );
    const ada = catalog.dashboards.find((item) => item.member.name === "Ada");

    expect(catalog.dashboards).toHaveLength(2);
    expect(ada?.confidence).toMatchObject({
      level: "partial",
      blindTaskCount: 1,
      unestimatedTaskCount: 1,
      unresolvedTaskCount: 1
    });
    expect(ada?.capacity).toMatchObject({
      state: "attention",
      uncertainProjectCount: 1,
      checkpoints: [
        {
          date: "2026-09-03",
          cumulativeRemainingHours: 8,
          availableHours: 24,
          balanceHours: 16
        }
      ]
    });
  });
});
