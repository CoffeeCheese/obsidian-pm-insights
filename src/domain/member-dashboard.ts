import { isDateOnly } from "./gate-schedule";
import { scheduleDaysBetween } from "./schedule-calendar";
import type { GateRiskSnapshot, GateRiskState } from "./gate-risk";
import {
  resolveMemberDeliveryCommitments,
  type MemberDeliveryPlan
} from "./member-delivery-commitments";
import type {
  MemberDashboardSettings,
  MemberInsight,
  MemberRatios,
  RatioMetric,
  TaskInsight,
  TaskRecord
} from "../model";

const DAY_MS = 86_400_000;

export type MemberDashboardHealth = "normal" | "attention" | "high" | "overdue";
export type MemberDashboardDeadlineSource = "stage" | "unknown";
export type MemberDashboardDriverKind =
  | "overdue"
  | "capacity"
  | "gate"
  | "unestimated"
  | "unscheduled"
  | "overrun";

export interface MemberDashboardWindow {
  startDate: string;
  endDate: string;
  days: number;
  includeWeekends: boolean;
  hoursPerDay: number;
}

export interface MemberDashboardTask {
  key: string;
  task: TaskInsight;
  effectiveDeadline: string | null;
  deadlineSource: MemberDashboardDeadlineSource;
  allocatedEstimate: number;
  allocatedLogged: number;
  allocatedRemaining: number;
  inWindow: boolean;
  overdue: boolean;
  gateRisk: MemberDashboardHealth | null;
}

export interface MemberDashboardCheckpoint {
  date: string;
  remainingHours: number;
  availableHours: number;
  balanceHours: number;
  utilizationPercentage: number | null;
  dueTaskCount: number;
  taskKeys: string[];
  state: MemberDashboardHealth;
}

export interface MemberDashboardDriver {
  kind: MemberDashboardDriverKind;
  state: MemberDashboardHealth;
  taskCount: number;
  hours: number;
  taskKeys: string[];
}

export interface MemberDashboardProjectLoad {
  projectId: string;
  projectTitle: string;
  hours: number;
  percentage: number | null;
  taskKeys: string[];
}

export interface MemberDashboardComparison {
  sampleSize: number;
  loadPercentage: number | null;
  plannedClosurePercentage: number | null;
  overduePercentage: number | null;
  overrunPercentage: number | null;
  ledgerTaskClosurePercentage: number | null;
  ledgerPlannedClosurePercentage: number | null;
  ledgerTimeConsumptionPercentage: number | null;
  ledgerOverrunPercentage: number | null;
  ledgerEstimateAccuracyPercentage: number | null;
  projectCount: number | null;
  sharedPercentage: number | null;
  highPriorityPercentage: number | null;
  ledgerEstimateCoveragePercentage: number | null;
}

export interface MemberDashboardMetric {
  memberKey: string;
  memberName: string;
  health: MemberDashboardHealth;
  tasks: MemberDashboardTask[];
  unconfiguredProjectIds: string[];
  windowTaskKeys: string[];
  allRemainingHours: number;
  committedHours: number;
  laterHours: number;
  unscheduledHours: number;
  availableHours: number;
  balanceHours: number;
  loadPercentage: number | null;
  completedTaskCount: number;
  windowTaskCount: number;
  overdueTaskCount: number;
  unestimatedTaskCount: number;
  unscheduledTaskCount: number;
  projectCount: number;
  sharedPercentage: number | null;
  highPriorityPercentage: number | null;
  overduePercentage: number | null;
  ratios: MemberRatios;
  windowRatios: MemberRatios;
  checkpoints: MemberDashboardCheckpoint[];
  drivers: MemberDashboardDriver[];
  projects: MemberDashboardProjectLoad[];
}

export interface MemberDashboardSnapshot {
  window: MemberDashboardWindow;
  members: MemberDashboardMetric[];
  comparison: MemberDashboardComparison;
  teamProjects: MemberDashboardProjectLoad[];
}

export interface MemberDashboardOptions {
  today: string;
  settings: MemberDashboardSettings;
  workdayHours: number;
  calendarDayHours: number;
  gateRisk: GateRiskSnapshot;
  allTasks: readonly TaskRecord[];
  highPriorityIds: Set<string>;
}

interface TaskGateContext {
  stageDate: string | null;
  blockerState: MemberDashboardHealth | null;
  blockerDate: string | null;
}

const HEALTH_SEVERITY: Record<MemberDashboardHealth, number> = {
  normal: 0,
  attention: 1,
  high: 2,
  overdue: 3
};

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ratio(numerator: number, denominator: number): RatioMetric {
  return {
    numerator: round(numerator),
    denominator: round(denominator),
    percentage: denominator > 0 ? round((numerator / denominator) * 100) : null
  };
}

function dateValue(value: string): number {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateString(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

function addScheduleDays(from: string, days: number, includeWeekends: boolean): string {
  let cursor = dateValue(from);
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    cursor += DAY_MS;
    const weekday = new Date(cursor).getUTCDay();
    if (includeWeekends || (weekday !== 0 && weekday !== 6)) remaining -= 1;
  }
  return dateString(cursor);
}

export function memberDashboardWindowEnd(
  today: string,
  settings: MemberDashboardSettings
): string {
  if (settings.windowMode === "custom"
      && isDateOnly(settings.customEndDate)
      && settings.customEndDate >= today) {
    return settings.customEndDate;
  }
  const days = settings.windowMode === "7"
    ? 7
    : settings.windowMode === "30"
      ? 30
      : 14;
  return addScheduleDays(today, days, settings.includeWeekends);
}

export function memberDashboardTaskKey(
  task: Pick<TaskInsight, "projectId" | "id">
): string {
  return `${task.projectId}\u0000${task.id}`;
}

function taskDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return isDateOnly(date) ? date : null;
}

function isCancelled(task: TaskInsight): boolean {
  const status = task.status.trim().toLocaleLowerCase();
  return status === "cancelled" || status === "canceled";
}

function gateHealth(state: GateRiskState): MemberDashboardHealth | null {
  if (state === "overdue") return "overdue";
  if (state === "high") return "high";
  if (state === "attention") return "attention";
  return null;
}

function worseHealth(
  left: MemberDashboardHealth | null,
  right: MemberDashboardHealth | null
): MemberDashboardHealth | null {
  if (!left) return right;
  if (!right) return left;
  return HEALTH_SEVERITY[right] > HEALTH_SEVERITY[left] ? right : left;
}

function gateContexts(snapshot: GateRiskSnapshot): Map<string, TaskGateContext> {
  const contexts = new Map<string, TaskGateContext>();
  const context = (projectId: string, taskId: string): TaskGateContext => {
    const key = `${projectId}\u0000${taskId}`;
    const existing = contexts.get(key);
    if (existing) return existing;
    const created: TaskGateContext = {
      stageDate: null,
      blockerState: null,
      blockerDate: null
    };
    contexts.set(key, created);
    return created;
  };

  for (const project of snapshot.projects) {
    for (const gate of project.gates) {
      if (gate.kind === "stage") {
        for (const task of gate.tasks) {
          context(task.projectId, task.id).stageDate ??= gate.gateDate;
        }
      }
      for (const task of gate.blockingTasks) {
        const target = context(task.projectId, task.id);
        const health = gateHealth(gate.state);
        if (HEALTH_SEVERITY[health ?? "normal"]
            > HEALTH_SEVERITY[target.blockerState ?? "normal"]) {
          target.blockerDate = gate.gateDate;
        }
        target.blockerState = worseHealth(target.blockerState, health);
      }
    }
  }
  return contexts;
}

function taskMetric(
  task: TaskInsight,
  context: TaskGateContext | undefined,
  deliveryDate: string | null,
  today: string,
  endDate: string
): MemberDashboardTask {
  const dueDate = taskDate(task.dueDate);
  const effectiveDeadline = deliveryDate;
  const deadlineSource: MemberDashboardDeadlineSource = deliveryDate ? "stage" : "unknown";
  const allocation = Math.max(task.resolvedAssignees.length, 1);
  const completedWindowDate = dueDate ?? effectiveDeadline;
  const inWindow = effectiveDeadline !== null
    && effectiveDeadline <= endDate
    && (!task.completed || (completedWindowDate !== null && completedWindowDate >= today));
  const overdueDate = dueDate ?? effectiveDeadline;
  const overdue = !task.completed && overdueDate !== null && overdueDate < today;
  let gateRisk = context?.blockerState ?? null;
  const riskStageDate = context?.stageDate ?? effectiveDeadline;
  if (!task.completed && dueDate && riskStageDate && dueDate > riskStageDate) {
    gateRisk = worseHealth(gateRisk, riskStageDate < today ? "overdue" : "high");
  }
  if (!task.completed && context?.blockerDate && context.blockerDate < today) {
    gateRisk = "overdue";
  }
  return {
    key: memberDashboardTaskKey(task),
    task,
    effectiveDeadline,
    deadlineSource,
    allocatedEstimate: round(task.estimate / allocation),
    allocatedLogged: round(task.logged / allocation),
    allocatedRemaining: round(task.remaining / allocation),
    inWindow,
    overdue,
    gateRisk
  };
}

function memberRatios(tasks: MemberDashboardTask[]): MemberRatios {
  const completed = tasks.filter((task) => task.task.completed);
  const estimated = tasks.filter((task) => task.allocatedEstimate > 0);
  const startedEstimated = estimated.filter((task) => task.allocatedLogged > 0);
  const completedEstimated = startedEstimated.filter((task) => task.task.completed);
  const totalPlanned = estimated.reduce((total, task) => total + task.allocatedEstimate, 0);
  const completedPlanned = estimated
    .filter((task) => task.task.completed)
    .reduce((total, task) => total + task.allocatedEstimate, 0);
  const estimatedLogged = estimated.reduce((total, task) => total + task.allocatedLogged, 0);
  return {
    taskClosure: ratio(completed.length, tasks.length),
    plannedClosure: ratio(completedPlanned, totalPlanned),
    timeConsumption: ratio(estimatedLogged, totalPlanned),
    overrunTasks: ratio(
      startedEstimated.filter((task) => task.allocatedLogged > task.allocatedEstimate).length,
      startedEstimated.length
    ),
    estimateAccuracy: ratio(
      completedEstimated.filter((task) => {
        const consumption = task.allocatedLogged / task.allocatedEstimate;
        return consumption >= 0.8 && consumption <= 1.2;
      }).length,
      completedEstimated.length
    ),
    estimateCoverage: ratio(estimated.length, tasks.length)
  };
}

function checkpointState(
  overdue: boolean,
  remaining: number,
  available: number,
  utilization: number | null
): MemberDashboardHealth {
  if (overdue && remaining > 0) return "overdue";
  if (remaining > available) return "high";
  if ((utilization ?? 0) >= 80) return "attention";
  return "normal";
}

function median(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (available.length === 0) return null;
  const middle = Math.floor(available.length / 2);
  if (available.length % 2 === 1) return available[middle] ?? null;
  return round(((available[middle - 1] ?? 0) + (available[middle] ?? 0)) / 2);
}

function projectLoads(tasks: MemberDashboardTask[]): MemberDashboardProjectLoad[] {
  const projects = new Map<string, MemberDashboardProjectLoad>();
  for (const metric of tasks) {
    if (metric.task.completed || metric.allocatedRemaining <= 0 || !metric.inWindow) continue;
    let project = projects.get(metric.task.projectId);
    if (!project) {
      project = {
        projectId: metric.task.projectId,
        projectTitle: metric.task.projectTitle,
        hours: 0,
        percentage: null,
        taskKeys: []
      };
      projects.set(project.projectId, project);
    }
    project.hours += metric.allocatedRemaining;
    project.taskKeys.push(metric.key);
  }
  const total = [...projects.values()].reduce((sum, project) => sum + project.hours, 0);
  return [...projects.values()]
    .map((project) => ({
      ...project,
      hours: round(project.hours),
      percentage: total > 0 ? round((project.hours / total) * 100) : null
    }))
    .sort((left, right) => right.hours - left.hours
      || left.projectTitle.localeCompare(right.projectTitle));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function driver(
  kind: MemberDashboardDriverKind,
  state: MemberDashboardHealth,
  tasks: MemberDashboardTask[],
  hours = 0
): MemberDashboardDriver | null {
  if (tasks.length === 0 && hours <= 0) return null;
  return {
    kind,
    state,
    taskCount: tasks.length,
    hours: round(hours),
    taskKeys: unique(tasks.map((task) => task.key))
  };
}

function memberMetric(
  member: MemberInsight,
  contexts: Map<string, TaskGateContext>,
  window: MemberDashboardWindow,
  highPriorityIds: Set<string>,
  unconfiguredProjectIds: Set<string>,
  deliveryPlan: MemberDeliveryPlan
): MemberDashboardMetric {
  const commitmentsByTask = new Map(deliveryPlan.commitments.flatMap((commitment) =>
    commitment.taskKeys.map((key) => [key, commitment] as const)
  ));
  const tasks = member.tasks
    .filter((task) => !isCancelled(task) && !task.archived)
    .map((task) => taskMetric(
      task,
      contexts.get(memberDashboardTaskKey(task)),
      commitmentsByTask.get(memberDashboardTaskKey(task))?.deliveryDate ?? null,
      window.startDate,
      window.endDate
    ));
  const windowTasks = tasks.filter((task) => task.inWindow);
  const activeWindowTasks = windowTasks.filter((task) => !task.task.completed);
  const unscheduledTasks = tasks.filter((task) =>
    !task.task.completed && task.effectiveDeadline === null
  );
  const unestimatedTasks = tasks.filter((task) =>
    !task.task.completed
      && task.allocatedEstimate <= 0
      && (task.inWindow || task.effectiveDeadline === null)
  );
  const overdueTasks = activeWindowTasks.filter((task) => task.overdue);
  const gateTasks = tasks.filter((task) => !task.task.completed && task.gateRisk !== null);
  const overrunTasks = windowTasks.filter((task) =>
    !task.task.completed
      && task.allocatedEstimate > 0
      && task.allocatedLogged > task.allocatedEstimate
  );
  const committedTasks = activeWindowTasks.filter((task) => task.allocatedRemaining > 0);
  const allRemainingHours = round(tasks.reduce((total, task) =>
    total + (task.task.completed ? 0 : task.allocatedRemaining), 0));
  const committedHours = round(committedTasks.reduce(
    (total, task) => total + task.allocatedRemaining,
    0
  ));
  const laterHours = round(tasks.reduce((total, task) =>
    total + (!task.task.completed
        && task.effectiveDeadline !== null
        && task.effectiveDeadline > window.endDate
      ? task.allocatedRemaining
      : 0), 0));
  const unscheduledHours = round(unscheduledTasks.reduce(
    (total, task) => total + task.allocatedRemaining,
    0
  ));
  const availableHours = round(window.days * window.hoursPerDay);
  const balanceHours = round(availableHours - committedHours);
  const loadPercentage = availableHours > 0
    ? round((committedHours / availableHours) * 100)
    : committedHours > 0
      ? null
      : 0;

  const checkpointDates = unique(committedTasks.map((task) =>
    task.effectiveDeadline !== null && task.effectiveDeadline < window.startDate
      ? window.startDate
      : task.effectiveDeadline ?? window.startDate
  )).sort();
  const checkpoints = checkpointDates.map((date): MemberDashboardCheckpoint => {
    const cumulative = committedTasks.filter((task) => {
      const checkpointDate = task.effectiveDeadline !== null
          && task.effectiveDeadline < window.startDate
        ? window.startDate
        : task.effectiveDeadline;
      return checkpointDate !== null && checkpointDate <= date;
    });
    const due = committedTasks.filter((task) => {
      const checkpointDate = task.effectiveDeadline !== null
          && task.effectiveDeadline < window.startDate
        ? window.startDate
        : task.effectiveDeadline;
      return checkpointDate === date;
    });
    const remainingHours = round(cumulative.reduce(
      (total, task) => total + task.allocatedRemaining,
      0
    ));
    const available = round(Math.max(0, scheduleDaysBetween(
      window.startDate,
      date,
      window.includeWeekends
    )) * window.hoursPerDay);
    const utilization = available > 0
      ? round((remainingHours / available) * 100)
      : remainingHours > 0
        ? null
        : 0;
    const hasOverdue = due.some((task) => task.overdue);
    return {
      date,
      remainingHours,
      availableHours: available,
      balanceHours: round(available - remainingHours),
      utilizationPercentage: utilization,
      dueTaskCount: due.length,
      taskKeys: cumulative.map((task) => task.key),
      state: checkpointState(hasOverdue, remainingHours, available, utilization)
    };
  });
  const worstCheckpoint = checkpoints.reduce<MemberDashboardCheckpoint | null>(
    (worst, checkpoint) => !worst
        || HEALTH_SEVERITY[checkpoint.state] > HEALTH_SEVERITY[worst.state]
      ? checkpoint
      : worst,
    null
  );
  const capacityTasks = worstCheckpoint
    ? tasks.filter((task) => worstCheckpoint.taskKeys.includes(task.key))
    : [];
  const capacityDriver = worstCheckpoint && worstCheckpoint.state !== "normal"
    ? driver(
        "capacity",
        worstCheckpoint.state,
        capacityTasks,
        Math.max(0, -worstCheckpoint.balanceHours)
      )
    : null;
  const gateState = gateTasks.reduce<MemberDashboardHealth>((state, task) =>
    worseHealth(state, task.gateRisk) ?? state, "normal");
  const drivers = [
    driver("overdue", "overdue", overdueTasks),
    capacityDriver,
    driver("gate", gateState, gateTasks),
    driver("unestimated", "attention", unestimatedTasks),
    driver("unscheduled", "attention", unscheduledTasks, unscheduledHours),
    driver("overrun", "attention", overrunTasks)
  ].filter((candidate): candidate is MemberDashboardDriver => candidate !== null)
    .sort((left, right) => HEALTH_SEVERITY[right.state] - HEALTH_SEVERITY[left.state]);
  const health = drivers.reduce<MemberDashboardHealth>((state, candidate) =>
    worseHealth(state, candidate.state) ?? state, "normal");
  const projectIds = new Set([
    ...activeWindowTasks.map((task) => task.task.projectId),
    ...unscheduledTasks.map((task) => task.task.projectId)
  ]);
  const sharedTaskCount = windowTasks.filter((task) =>
    task.task.assignmentKind === "shared"
  ).length;
  const highPriorityTaskCount = windowTasks.filter((task) =>
    task.task.priority !== null && highPriorityIds.has(task.task.priority)
  ).length;
  const windowRatios = memberRatios(windowTasks);
  return {
    memberKey: member.key,
    memberName: member.name,
    health,
    tasks,
    unconfiguredProjectIds: unique(tasks
      .map((task) => task.task.projectId)
      .filter((projectId) => unconfiguredProjectIds.has(projectId))),
    windowTaskKeys: windowTasks.map((task) => task.key),
    allRemainingHours,
    committedHours,
    laterHours,
    unscheduledHours,
    availableHours,
    balanceHours,
    loadPercentage,
    completedTaskCount: windowTasks.filter((task) => task.task.completed).length,
    windowTaskCount: windowTasks.length,
    overdueTaskCount: overdueTasks.length,
    unestimatedTaskCount: unestimatedTasks.length,
    unscheduledTaskCount: unscheduledTasks.length,
    projectCount: projectIds.size,
    sharedPercentage: ratio(sharedTaskCount, windowTasks.length).percentage,
    highPriorityPercentage: ratio(highPriorityTaskCount, windowTasks.length).percentage,
    overduePercentage: ratio(overdueTasks.length, activeWindowTasks.length).percentage,
    ratios: member.ratios,
    windowRatios,
    checkpoints,
    drivers,
    projects: projectLoads(tasks)
  };
}

function teamProjectLoads(members: MemberDashboardMetric[]): MemberDashboardProjectLoad[] {
  const projects = new Map<string, MemberDashboardProjectLoad>();
  for (const member of members) {
    for (const project of member.projects) {
      let target = projects.get(project.projectId);
      if (!target) {
        target = {
          projectId: project.projectId,
          projectTitle: project.projectTitle,
          hours: 0,
          percentage: null,
          taskKeys: []
        };
        projects.set(project.projectId, target);
      }
      target.hours += project.hours;
      target.taskKeys.push(...project.taskKeys);
    }
  }
  const total = [...projects.values()].reduce((sum, project) => sum + project.hours, 0);
  return [...projects.values()]
    .map((project) => ({
      ...project,
      hours: round(project.hours),
      percentage: total > 0 ? round((project.hours / total) * 100) : null,
      taskKeys: unique(project.taskKeys)
    }))
    .sort((left, right) => right.hours - left.hours
      || left.projectTitle.localeCompare(right.projectTitle));
}

export function aggregateMemberDashboard(
  members: MemberInsight[],
  options: MemberDashboardOptions
): MemberDashboardSnapshot {
  const endDate = memberDashboardWindowEnd(options.today, options.settings);
  const includeWeekends = options.settings.includeWeekends;
  const window: MemberDashboardWindow = {
    startDate: options.today,
    endDate,
    days: Math.max(0, scheduleDaysBetween(options.today, endDate, includeWeekends)),
    includeWeekends,
    hoursPerDay: includeWeekends ? options.calendarDayHours : options.workdayHours
  };
  const contexts = gateContexts(options.gateRisk);
  const unconfiguredProjectIds = new Set(options.gateRisk.projects
    .filter((project) => !project.configured)
    .map((project) => project.project.id));
  const people = members.filter((member) => member.kind === "member");
  const deliveryPlans = resolveMemberDeliveryCommitments({
    members: people,
    allTasks: options.allTasks,
    gateRisk: options.gateRisk
  });
  const drafts = people.map((member) =>
    memberMetric(
      member,
      contexts,
      window,
      options.highPriorityIds,
      unconfiguredProjectIds,
      deliveryPlans.get(member.key) ?? { commitments: [], unresolved: [] }
    ));
  const comparison: MemberDashboardComparison = {
    sampleSize: drafts.length,
    loadPercentage: median(drafts.map((member) => member.loadPercentage)),
    plannedClosurePercentage: median(drafts.map((member) =>
      member.windowRatios.plannedClosure.percentage)),
    overduePercentage: median(drafts.map((member) => member.overduePercentage)),
    overrunPercentage: median(drafts.map((member) =>
      member.windowRatios.overrunTasks.percentage)),
    ledgerTaskClosurePercentage: median(drafts.map((member) =>
      member.ratios.taskClosure.percentage)),
    ledgerPlannedClosurePercentage: median(drafts.map((member) =>
      member.ratios.plannedClosure.percentage)),
    ledgerTimeConsumptionPercentage: median(drafts.map((member) =>
      member.ratios.timeConsumption.percentage)),
    ledgerOverrunPercentage: median(drafts.map((member) =>
      member.ratios.overrunTasks.percentage)),
    ledgerEstimateAccuracyPercentage: median(drafts.map((member) =>
      member.ratios.estimateAccuracy.percentage)),
    projectCount: median(drafts.map((member) => member.projectCount)),
    sharedPercentage: median(drafts.map((member) => member.sharedPercentage)),
    highPriorityPercentage: median(drafts.map((member) => member.highPriorityPercentage)),
    ledgerEstimateCoveragePercentage: median(drafts.map((member) =>
      member.ratios.estimateCoverage.percentage))
  };
  return {
    window,
    members: drafts,
    comparison,
    teamProjects: teamProjectLoads(drafts)
  };
}
