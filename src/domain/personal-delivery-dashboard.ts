import {
  aggregateMemberDashboard,
  type MemberDashboardHealth,
  type MemberDashboardMetric,
  type MemberDashboardOptions
} from "./member-dashboard";
import {
  resolveMemberDeliveryCommitments,
  type MemberDeliveryPlan,
  type MemberProjectCommitment
} from "./member-delivery-commitments";
import { scheduleDaysBetween } from "./schedule-calendar";
import type { MemberInsight } from "../model";

export type DeliveryRiskSignalKind =
  | "overdue"
  | "capacity"
  | "gate"
  | "due-after-stage"
  | "overrun";

export interface PersonalDashboardTaskRef {
  key: string;
}

export interface PersonalDeliveryCommitment {
  projectId: string;
  projectTitle: string;
  stageId: string;
  stageName: string;
  taskCount: number;
  taskKeys: string[];
}

export interface PersonalDeliveryProgress {
  completedPlannedHours: number;
  totalPlannedHours: number;
  percentage: number | null;
  completedTaskCount: number;
  taskCount: number;
}

export interface PersonalDeliveryRiskSignal {
  kind: DeliveryRiskSignalKind;
  state: MemberDashboardHealth;
  taskCount: number;
  hours: number;
  taskKeys: string[];
}

export interface PersonalDeliveryWindow {
  date: string;
  commitments: PersonalDeliveryCommitment[];
  progress: PersonalDeliveryProgress;
  remainingHours: number;
  cumulativeRemainingHours: number;
  cumulativeCapacityHours: number;
  balanceHours: number;
  state: MemberDashboardHealth;
  signals: PersonalDeliveryRiskSignal[];
  taskKeys: string[];
}

export type PersonalProjectDelivery = {
  resolution: "resolved" | "partial";
  stageId: string;
  stageName: string;
  windowStartDate: string;
  date: string;
  unresolvedTaskCount: number;
} | {
  resolution: "unresolved";
  stageId: null;
  stageName: null;
  windowStartDate: null;
  date: null;
  unresolvedTaskCount: number;
};

export interface PersonalProjectLoad {
  projectId: string;
  projectTitle: string;
  remainingHours: number;
  sharePercentage: number | null;
  openTaskCount: number;
  unestimatedTaskCount: number;
  delivery: PersonalProjectDelivery;
  taskKeys: string[];
}

export interface PersonalWorkload {
  totalRemainingHours: number;
  openTaskCount: number;
  unestimatedTaskCount: number;
  projects: PersonalProjectLoad[];
  taskKeys: string[];
}

export interface PersonalCapacityCheckpoint {
  windowStartDate: string;
  date: string;
  windowDays: number;
  projectIds: string[];
  projectTitles: string[];
  dueRemainingHours: number;
  cumulativeRemainingHours: number;
  availableHours: number;
  balanceHours: number;
  utilizationPercentage: number | null;
  state: MemberDashboardHealth;
  taskKeys: string[];
}

export interface PersonalDeliveryCapacity {
  state: MemberDashboardHealth;
  criticalCheckpoint: PersonalCapacityCheckpoint | null;
  constrainedWindowCount: number;
  uncertainProjectCount: number;
  unestimatedTaskCount: number;
  unscheduledRemainingHours: number;
  checkpoints: PersonalCapacityCheckpoint[];
}

export interface PersonalDashboardConfidence {
  level: "complete" | "partial";
  blindTaskCount: number;
  unestimatedTaskCount: number;
  unresolvedTaskCount: number;
  unconfiguredProjectIds: string[];
  taskKeys: string[];
}

export interface PersonalDeliveryDashboard {
  member: { key: string; name: string };
  state: MemberDashboardHealth;
  deliveryWindows: PersonalDeliveryWindow[];
  workload: PersonalWorkload;
  capacity: PersonalDeliveryCapacity;
  confidence: PersonalDashboardConfidence;
}

export interface PersonalDashboardCatalog {
  window: {
    startDate: string;
    endDate: string;
    days: number;
    includeWeekends: boolean;
    hoursPerDay: number;
  };
  dashboards: PersonalDeliveryDashboard[];
}

export interface PersonalDashboardInput extends MemberDashboardOptions {
  members: MemberInsight[];
}

const HEALTH_SEVERITY: Record<MemberDashboardHealth, number> = {
  normal: 0,
  attention: 1,
  high: 2,
  overdue: 3
};

const SIGNAL_ORDER: Record<DeliveryRiskSignalKind, number> = {
  overdue: 0,
  capacity: 1,
  gate: 2,
  "due-after-stage": 3,
  overrun: 4
};

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? round((numerator / denominator) * 100) : null;
}

function worseHealth(
  left: MemberDashboardHealth,
  right: MemberDashboardHealth
): MemberDashboardHealth {
  return HEALTH_SEVERITY[right] > HEALTH_SEVERITY[left] ? right : left;
}

function signal(
  kind: DeliveryRiskSignalKind,
  state: MemberDashboardHealth,
  taskKeys: readonly string[],
  hours = 0
): PersonalDeliveryRiskSignal | null {
  const keys = unique(taskKeys);
  if (keys.length === 0 && hours <= 0) return null;
  return { kind, state, taskCount: keys.length, hours: round(hours), taskKeys: keys };
}

function taskDate(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function aggregateSignals(
  signals: readonly PersonalDeliveryRiskSignal[]
): PersonalDeliveryRiskSignal[] {
  const byKind = new Map<DeliveryRiskSignalKind, PersonalDeliveryRiskSignal>();
  for (const item of signals) {
    const current = byKind.get(item.kind);
    if (!current) {
      byKind.set(item.kind, { ...item, taskKeys: [...item.taskKeys] });
      continue;
    }
    current.state = worseHealth(current.state, item.state);
    current.hours = round(Math.max(current.hours, item.hours));
    current.taskKeys = unique([...current.taskKeys, ...item.taskKeys]);
    current.taskCount = current.taskKeys.length;
  }
  return [...byKind.values()].sort((left, right) =>
    HEALTH_SEVERITY[right.state] - HEALTH_SEVERITY[left.state]
      || SIGNAL_ORDER[left.kind] - SIGNAL_ORDER[right.kind]);
}

function commitmentView(
  commitment: MemberProjectCommitment,
  taskKeys: string[]
): PersonalDeliveryCommitment {
  return {
    projectId: commitment.projectId,
    projectTitle: commitment.projectTitle,
    stageId: commitment.stageId,
    stageName: commitment.stageName,
    taskCount: taskKeys.length,
    taskKeys
  };
}

interface ProjectLoadDraft {
  projectId: string;
  projectTitle: string;
  remainingHours: number;
  openTaskCount: number;
  unestimatedTaskCount: number;
  taskKeys: string[];
}

function projectDelivery(
  project: ProjectLoadDraft,
  plan: MemberDeliveryPlan,
  activeTaskKeys: ReadonlySet<string>
): PersonalProjectDelivery {
  const commitment = plan.commitments.find((item) => item.projectId === project.projectId);
  const unresolvedTaskCount = unique(plan.unresolved
    .filter((item) => item.projectId === project.projectId)
    .flatMap((item) => item.taskKeys)
    .filter((key) => activeTaskKeys.has(key))).length;
  if (!commitment) {
    return {
      resolution: "unresolved",
      stageId: null,
      stageName: null,
      windowStartDate: null,
      date: null,
      unresolvedTaskCount: Math.max(unresolvedTaskCount, project.openTaskCount)
    };
  }
  return {
    resolution: unresolvedTaskCount > 0 ? "partial" : "resolved",
    stageId: commitment.stageId,
    stageName: commitment.stageName,
    windowStartDate: commitment.windowStartDate,
    date: commitment.deliveryDate,
    unresolvedTaskCount
  };
}

function summarizeProjectWorkload(
  metric: MemberDashboardMetric,
  plan: MemberDeliveryPlan
): PersonalWorkload {
  const tasks = [...new Map(metric.tasks
    .filter((task) => !task.task.completed)
    .map((task) => [task.key, task] as const)).values()];
  const activeTaskKeys = new Set(tasks.map((task) => task.key));
  const byProject = new Map<string, ProjectLoadDraft>();
  for (const task of tasks) {
    let project = byProject.get(task.task.projectId);
    if (!project) {
      project = {
        projectId: task.task.projectId,
        projectTitle: task.task.projectTitle,
        remainingHours: 0,
        openTaskCount: 0,
        unestimatedTaskCount: 0,
        taskKeys: []
      };
      byProject.set(project.projectId, project);
    }
    project.remainingHours += Number.isFinite(task.allocatedRemaining)
      ? Math.max(0, task.allocatedRemaining)
      : 0;
    project.openTaskCount += 1;
    project.unestimatedTaskCount += task.allocatedEstimate <= 0 ? 1 : 0;
    project.taskKeys.push(task.key);
  }

  const totalRemainingHours = round([...byProject.values()].reduce(
    (total, project) => total + project.remainingHours,
    0
  ));
  const projects = [...byProject.values()].map((project): PersonalProjectLoad => {
    const remainingHours = round(project.remainingHours);
    return {
      ...project,
      remainingHours,
      sharePercentage: remainingHours > 0
        ? percentage(remainingHours, totalRemainingHours)
        : null,
      delivery: projectDelivery(project, plan, activeTaskKeys),
      taskKeys: unique(project.taskKeys)
    };
  }).sort((left, right) => {
    const leftDate = left.delivery.date ?? "\uffff";
    const rightDate = right.delivery.date ?? "\uffff";
    return right.remainingHours - left.remainingHours
      || leftDate.localeCompare(rightDate)
      || left.projectTitle.localeCompare(right.projectTitle)
      || left.projectId.localeCompare(right.projectId);
  });

  return {
    totalRemainingHours,
    openTaskCount: tasks.length,
    unestimatedTaskCount: tasks.filter((task) => task.allocatedEstimate <= 0).length,
    projects,
    taskKeys: tasks.map((task) => task.key)
  };
}

function capacityCheckpointState(
  date: string,
  today: string,
  remainingHours: number,
  availableHours: number,
  utilizationPercentage: number | null
): MemberDashboardHealth {
  if (date < today && remainingHours > 0) return "overdue";
  if (remainingHours > availableHours) return "high";
  if ((utilizationPercentage ?? 0) >= 80) return "attention";
  return "normal";
}

function summarizeDeliveryCapacity(
  workload: PersonalWorkload,
  today: string,
  includeWeekends: boolean,
  hoursPerDay: number
): PersonalDeliveryCapacity {
  const scheduledProjects = workload.projects
    .filter((project) => project.delivery.date !== null)
    .sort((left, right) => (left.delivery.date ?? "").localeCompare(right.delivery.date ?? "")
      || left.projectTitle.localeCompare(right.projectTitle));
  const projectsByDate = new Map<string, PersonalProjectLoad[]>();
  for (const project of scheduledProjects) {
    const date = project.delivery.date;
    if (date === null) continue;
    const projects = projectsByDate.get(date) ?? [];
    projects.push(project);
    projectsByDate.set(date, projects);
  }

  let cumulativeProjects: PersonalProjectLoad[] = [];
  const checkpoints = [...projectsByDate.entries()].map(([date, projects]) => {
    cumulativeProjects = [...cumulativeProjects, ...projects];
    const dueRemainingHours = round(projects.reduce(
      (total, project) => total + project.remainingHours,
      0
    ));
    const cumulativeRemainingHours = round(cumulativeProjects.reduce(
      (total, project) => total + project.remainingHours,
      0
    ));
    const windowStartDate = cumulativeProjects.reduce((earliest, project) => {
      const start = project.delivery.windowStartDate;
      return start !== null && start < earliest ? start : earliest;
    }, date);
    const windowDays = Math.max(0, scheduleDaysBetween(
      windowStartDate,
      date,
      includeWeekends
    ));
    const availableHours = round(windowDays * hoursPerDay);
    const balanceHours = round(availableHours - cumulativeRemainingHours);
    const utilizationPercentage = availableHours > 0
      ? percentage(cumulativeRemainingHours, availableHours)
      : cumulativeRemainingHours > 0
        ? null
        : 0;
    return {
      windowStartDate,
      date,
      windowDays,
      projectIds: projects.map((project) => project.projectId),
      projectTitles: projects.map((project) => project.projectTitle),
      dueRemainingHours,
      cumulativeRemainingHours,
      availableHours,
      balanceHours,
      utilizationPercentage,
      state: capacityCheckpointState(
        date,
        today,
        cumulativeRemainingHours,
        availableHours,
        utilizationPercentage
      ),
      taskKeys: unique(cumulativeProjects.flatMap((project) => project.taskKeys))
    } satisfies PersonalCapacityCheckpoint;
  });
  const criticalCheckpoint = checkpoints.reduce<PersonalCapacityCheckpoint | null>(
    (critical, checkpoint) => {
      if (!critical) return checkpoint;
      const severity = HEALTH_SEVERITY[checkpoint.state] - HEALTH_SEVERITY[critical.state];
      if (severity !== 0) return severity > 0 ? checkpoint : critical;
      if (checkpoint.balanceHours !== critical.balanceHours) {
        return checkpoint.balanceHours < critical.balanceHours ? checkpoint : critical;
      }
      return checkpoint.date < critical.date ? checkpoint : critical;
    },
    null
  );
  const uncertainProjects = workload.projects.filter((project) =>
    project.delivery.resolution !== "resolved");

  return {
    state: worseHealth(
      criticalCheckpoint?.state ?? "normal",
      uncertainProjects.length > 0 || workload.unestimatedTaskCount > 0
        ? "attention"
        : "normal"
    ),
    criticalCheckpoint,
    constrainedWindowCount: checkpoints.filter((checkpoint) =>
      checkpoint.state !== "normal").length,
    uncertainProjectCount: uncertainProjects.length,
    unestimatedTaskCount: workload.unestimatedTaskCount,
    unscheduledRemainingHours: round(uncertainProjects
      .filter((project) => project.delivery.date === null)
      .reduce((total, project) => total + project.remainingHours, 0)),
    checkpoints
  };
}

export function buildPersonalDashboards(input: PersonalDashboardInput): PersonalDashboardCatalog {
  const people = input.members.filter((member) => member.kind === "member");
  const raw = aggregateMemberDashboard(people, input);
  const plans = resolveMemberDeliveryCommitments({
    members: people,
    allTasks: input.allTasks,
    gateRisk: input.gateRisk,
    deliveryProgressSettings: input.deliveryProgressSettings,
    includeArchived: input.includeArchived
  });

  const dashboards = raw.members.map((metric): PersonalDeliveryDashboard => {
    const plan = plans.get(metric.memberKey) ?? { commitments: [], unresolved: [] };
    const tasksByKey = new Map(metric.tasks.map((task) => [task.key, task]));
    const commitmentsByDate = new Map<string, PersonalDeliveryCommitment[]>();
    const workload = summarizeProjectWorkload(metric, plan);
    const capacity = summarizeDeliveryCapacity(
      workload,
      input.today,
      raw.window.includeWeekends,
      raw.window.hoursPerDay
    );

    for (const commitment of plan.commitments) {
      const keys = commitment.taskKeys.filter((key) => tasksByKey.has(key));
      const hasOpenWork = keys.some((key) => !tasksByKey.get(key)?.task.completed);
      if (keys.length === 0
          || commitment.deliveryDate > raw.window.endDate
          || (commitment.deliveryDate < raw.window.startDate && !hasOpenWork)) continue;
      const commitments = commitmentsByDate.get(commitment.deliveryDate) ?? [];
      commitments.push(commitmentView(commitment, keys));
      commitmentsByDate.set(commitment.deliveryDate, commitments);
    }

    let cumulativeKeys: string[] = [];
    const deliveryWindows = [...commitmentsByDate.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, commitments]): PersonalDeliveryWindow => {
        const taskKeys = unique(commitments.flatMap((item) => item.taskKeys));
        cumulativeKeys = unique([...cumulativeKeys, ...taskKeys]);
        const tasks = taskKeys.flatMap((key) => {
          const task = tasksByKey.get(key);
          return task ? [task] : [];
        });
        const cumulativeTasks = cumulativeKeys.flatMap((key) => {
          const task = tasksByKey.get(key);
          return task ? [task] : [];
        });
        const openTasks = tasks.filter((task) => !task.task.completed);
        const totalPlannedHours = round(tasks.reduce(
          (total, task) => total + task.allocatedEstimate, 0));
        const completedPlannedHours = round(tasks.reduce((total, task) =>
          total + (task.task.completed ? task.allocatedEstimate : 0), 0));
        const remainingHours = round(openTasks.reduce(
          (total, task) => total + task.allocatedRemaining, 0));
        const cumulativeRemainingHours = round(cumulativeTasks.reduce((total, task) =>
          total + (task.task.completed ? 0 : task.allocatedRemaining), 0));
        const checkpoint = capacity.checkpoints.find((item) => item.date === date)
          ?? metric.checkpoints.find((item) => item.date === date)
          ?? (date < raw.window.startDate
            ? metric.checkpoints.find((item) => item.date === raw.window.startDate)
            : undefined);
        const cumulativeCapacityHours = checkpoint?.availableHours ?? 0;
        const balanceHours = round(cumulativeCapacityHours - cumulativeRemainingHours);
        const overdueKeys = openTasks
          .filter((task) => date < raw.window.startDate || task.overdue)
          .map((task) => task.key);
        const dueAfterStageKeys = openTasks.filter((task) => {
          const dueDate = taskDate(task.task.dueDate);
          return dueDate !== null && dueDate > date;
        }).map((task) => task.key);
        const gateKeys = openTasks.filter((task) =>
          task.gateRisk !== null && !dueAfterStageKeys.includes(task.key)
        ).map((task) => task.key);
        const overrunKeys = openTasks.filter((task) =>
          task.allocatedEstimate > 0 && task.allocatedLogged > task.allocatedEstimate
        ).map((task) => task.key);
        const signals = [
          signal("overdue", "overdue", overdueKeys),
          signal("capacity", "high", cumulativeKeys, Math.max(0, -balanceHours)),
          signal("gate", gateKeys.reduce<MemberDashboardHealth>((state, key) =>
            worseHealth(state, tasksByKey.get(key)?.gateRisk ?? "normal"), "normal"), gateKeys),
          signal("due-after-stage", "high", dueAfterStageKeys),
          signal("overrun", "attention", overrunKeys)
        ].filter((item): item is PersonalDeliveryRiskSignal => item !== null)
          .filter((item) => item.kind !== "capacity" || balanceHours < 0);
        const state = signals.reduce<MemberDashboardHealth>((current, item) =>
          worseHealth(current, item.state),
        checkpoint?.state ?? "normal");
        return {
          date,
          commitments: commitments.sort((left, right) =>
            left.projectTitle.localeCompare(right.projectTitle)
              || left.stageName.localeCompare(right.stageName)),
          progress: {
            completedPlannedHours,
            totalPlannedHours,
            percentage: percentage(completedPlannedHours, totalPlannedHours),
            completedTaskCount: tasks.filter((task) => task.task.completed).length,
            taskCount: tasks.length
          },
          remainingHours,
          cumulativeRemainingHours,
          cumulativeCapacityHours,
          balanceHours,
          state,
          signals: aggregateSignals(signals),
          taskKeys
        };
      });

    const unresolvedKeys = unique(plan.unresolved.flatMap((item) => item.taskKeys))
      .filter((key) => tasksByKey.has(key));
    const unestimatedKeys = metric.tasks
      .filter((task) => !task.task.completed && task.allocatedEstimate <= 0
        && (task.inWindow || task.effectiveDeadline === null))
      .map((task) => task.key);
    const blindKeys = unique([...unresolvedKeys, ...unestimatedKeys]);
    return {
      member: { key: metric.memberKey, name: metric.memberName },
      state: capacity.state,
      deliveryWindows,
      workload,
      capacity,
      confidence: {
        level: blindKeys.length > 0 ? "partial" : "complete",
        blindTaskCount: blindKeys.length,
        unestimatedTaskCount: unique(unestimatedKeys).length,
        unresolvedTaskCount: unique(unresolvedKeys).length,
        unconfiguredProjectIds: metric.unconfiguredProjectIds,
        taskKeys: blindKeys
      }
    };
  });

  return {
    window: raw.window,
    dashboards
  };
}
