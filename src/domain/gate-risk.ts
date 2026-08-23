import { aggregateDeliveryProgress } from "./delivery-progress";
import { isDateOnly, validateGateSchedule } from "./gate-schedule";
import type {
  DeliveryProgressSettings,
  ProjectGateSchedule,
  ProjectRecord,
  TaskRecord
} from "../model";

export type GateRiskState =
  | "unconfigured"
  | "not-started"
  | "normal"
  | "attention"
  | "high"
  | "overdue"
  | "passed";

export type GateRiskReason =
  | "schedule-gap"
  | "window-closing"
  | "task-overdue"
  | "task-after-gate"
  | "gate-today"
  | "gate-overdue";

export type GateTiming = "early" | "on-time" | "late" | "unknown";

export type GateProgressSignal = "scheduled" | "planned" | "ahead" | "parallel";

export interface GateDataQuality {
  missingDue: number;
  unestimated: number;
  unassigned: number;
}

export type GateTaskRiskKind =
  | "task-overdue"
  | "task-after-gate"
  | "missing-due"
  | "unestimated"
  | "unassigned"
  | "acceptance-blocker"
  | "awaiting-acceptance"
  | "acceptance-incomplete"
  | "gate-overdue"
  | "gate-today"
  | "schedule-gap"
  | "window-closing"
  | "unfinished";

export interface GateTaskRiskSignal {
  kind: GateTaskRiskKind;
  days?: number;
}

export interface GateRiskMetric {
  id: string;
  name: string;
  kind: "stage" | "acceptance" | "launch";
  windowStart: string;
  gateDate: string;
  progress: number;
  expectedProgress: number | null;
  progressGap: number | null;
  progressSignal: GateProgressSignal;
  daysRemaining: number;
  state: Exclude<GateRiskState, "unconfigured">;
  skipped: boolean;
  reasons: GateRiskReason[];
  tasks: TaskRecord[];
  blockingTasks: TaskRecord[];
  quality: GateDataQuality;
  timing: GateTiming | null;
}

export interface ProjectGateRisk {
  project: ProjectRecord;
  configured: boolean;
  state: GateRiskState;
  gates: GateRiskMetric[];
  nearestGate: GateRiskMetric | null;
}

export interface GateRiskSnapshot {
  today: string;
  projects: ProjectGateRisk[];
  counts: Record<"unconfigured" | "normal" | "attention" | "high" | "overdue" | "passed", number>;
  nearestGate: { project: ProjectRecord; gate: GateRiskMetric } | null;
}

export type GateRiskSummaryState = "unconfigured" | "normal" | "attention" | "high" | "overdue";

export function gateRiskSummaryState(counts: GateRiskSnapshot["counts"]): GateRiskSummaryState {
  if (counts.overdue > 0) return "overdue";
  if (counts.high > 0) return "high";
  if (counts.attention > 0) return "attention";
  if (counts.unconfigured > 0) return "unconfigured";
  return "normal";
}

export interface GateRiskOptions {
  projectIds: Set<string>;
  includeArchived: boolean;
  settings: DeliveryProgressSettings;
  gateSchedules: Record<string, ProjectGateSchedule>;
  today: string;
}

const DAY_MS = 86_400_000;

function dateValue(value: string): number {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function daysBetween(from: string, to: string): number {
  return Math.round((dateValue(to) - dateValue(from)) / DAY_MS);
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function expectedProgress(windowStart: string, gateDate: string, today: string): number | null {
  if (today < windowStart) return 0;
  const duration = daysBetween(windowStart, gateDate);
  if (duration === 0) return today >= gateDate ? 100 : 0;
  return round(Math.max(0, Math.min(100, (daysBetween(windowStart, today) / duration) * 100)));
}

function taskDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return isDateOnly(date) ? date : null;
}

function dataQuality(tasks: TaskRecord[]): GateDataQuality {
  return {
    missingDue: tasks.filter((task) => !taskDate(task.dueDate)).length,
    // Root tasks represent requirements. Their delivery effort is planned on
    // the executable stage subtasks, so a root estimate would double count it.
    unestimated: tasks.filter((task) => task.hierarchy !== "root" && task.estimate <= 0).length,
    unassigned: tasks.filter((task) => task.assignees.length === 0).length
  };
}

export function gateTaskRiskSignals(
  task: TaskRecord,
  gate: GateRiskMetric,
  today: string,
  acceptanceBlocker = false
): GateTaskRiskSignal[] {
  const signals: GateTaskRiskSignal[] = [];
  const due = taskDate(task.dueDate);
  let hasTaskScheduleRisk = false;

  if (due === null) {
    signals.push({ kind: "missing-due" });
  } else {
    if (due < today) {
      signals.push({ kind: "task-overdue", days: daysBetween(due, today) });
      hasTaskScheduleRisk = true;
    }
    if (due > gate.gateDate) {
      signals.push({ kind: "task-after-gate", days: daysBetween(gate.gateDate, due) });
      hasTaskScheduleRisk = true;
    }
  }

  if (!hasTaskScheduleRisk) {
    if (gate.state === "overdue") {
      signals.push({ kind: "gate-overdue", days: Math.abs(gate.daysRemaining) });
    } else if (gate.reasons.includes("gate-today")) {
      signals.push({ kind: "gate-today" });
    } else if (gate.reasons.includes("schedule-gap")) {
      signals.push({ kind: "schedule-gap" });
    } else if (gate.reasons.includes("window-closing")) {
      signals.push({ kind: "window-closing" });
    }
  }

  if (acceptanceBlocker) {
    signals.push({ kind: "acceptance-blocker" });
  } else if (gate.kind === "acceptance" && task.hierarchy === "root") {
    signals.push({ kind: "awaiting-acceptance" });
  } else if (gate.kind === "launch" && task.hierarchy === "root") {
    signals.push({ kind: "acceptance-incomplete" });
  }

  if (task.hierarchy !== "root" && task.estimate <= 0) {
    signals.push({ kind: "unestimated" });
  }
  if (task.assignees.length === 0) signals.push({ kind: "unassigned" });
  if (signals.length === 0) signals.push({ kind: "unfinished" });
  return signals;
}

function uniqueTasks(tasks: TaskRecord[]): TaskRecord[] {
  return [...new Map(tasks.map((task) => [task.id, task])).values()];
}

function passTiming(tasks: TaskRecord[], gateDate: string): GateTiming {
  if (tasks.length === 0) return "unknown";
  const dates = tasks.map((task) => taskDate(task.completedAt));
  if (dates.some((date) => date === null)) return "unknown";
  const completed = dates.filter((date): date is string => date !== null).sort().at(-1);
  if (!completed) return "unknown";
  if (completed < gateDate) return "early";
  if (completed === gateDate) return "on-time";
  return "late";
}

function assessGate(input: {
  id: string;
  name: string;
  kind: GateRiskMetric["kind"];
  windowStart: string;
  gateDate: string;
  today: string;
  progress: number;
  tasks: TaskRecord[];
  blockingTasks?: TaskRecord[];
  timingTasks?: TaskRecord[];
  passed: boolean;
  skipped?: boolean;
  previousGatesPassed?: boolean;
}): GateRiskMetric {
  const unfinished = input.tasks.filter((task) => !task.completed);
  const expected = expectedProgress(input.windowStart, input.gateDate, input.today);
  const gap = expected === null ? null : round(Math.max(0, expected - input.progress));
  const daysRemaining = daysBetween(input.today, input.gateDate);
  const taskOverdue = unfinished.some((task) => {
    const due = taskDate(task.dueDate);
    return due !== null && due < input.today;
  });
  const taskAfterGate = unfinished.some((task) => {
    const due = taskDate(task.dueDate);
    return due !== null && due > input.gateDate;
  });
  const reasons: GateRiskReason[] = [];
  if (taskOverdue) reasons.push("task-overdue");
  if (taskAfterGate) reasons.push("task-after-gate");

  const beforeWindow = input.today < input.windowStart;
  const hasProgress = input.progress > 0;
  const progressSignal: GateProgressSignal = input.passed || input.kind === "launch"
    ? "scheduled"
    : !hasProgress && beforeWindow
      ? "planned"
      : hasProgress && input.previousGatesPassed === false
        ? "parallel"
        : hasProgress && beforeWindow
          ? "ahead"
          : "scheduled";

  let state: GateRiskMetric["state"];
  let timing: GateTiming | null = null;
  if (input.passed) {
    state = "passed";
    timing = input.skipped ? null : passTiming(input.timingTasks ?? input.tasks, input.gateDate);
  } else if (input.today > input.gateDate) {
    state = "overdue";
    reasons.push("gate-overdue");
  } else if (input.today === input.gateDate || taskOverdue || taskAfterGate || (gap ?? 0) >= 25) {
    state = "high";
    if (input.today === input.gateDate) reasons.push("gate-today");
    if ((gap ?? 0) >= 25) reasons.push("schedule-gap");
  } else {
    const duration = Math.max(0, daysBetween(input.windowStart, input.gateDate));
    const windowClosing = duration > 0 && daysRemaining / duration <= 0.2;
    if ((gap ?? 0) >= 10 || windowClosing) {
      state = "attention";
      if ((gap ?? 0) >= 10) reasons.push("schedule-gap");
      if (windowClosing) reasons.push("window-closing");
    } else if (beforeWindow && !hasProgress) {
      state = "not-started";
    } else {
      state = "normal";
    }
  }

  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    windowStart: input.windowStart,
    gateDate: input.gateDate,
    progress: input.progress,
    expectedProgress: expected,
    progressGap: gap,
    progressSignal,
    daysRemaining,
    state,
    skipped: input.skipped ?? false,
    reasons,
    tasks: unfinished,
    blockingTasks: input.blockingTasks ?? [],
    quality: dataQuality(unfinished),
    timing
  };
}

const ACTIVE_SEVERITY: Record<GateRiskMetric["state"], number> = {
  passed: -1,
  "not-started": 0,
  normal: 1,
  attention: 2,
  high: 3,
  overdue: 4
};

function projectState(gates: GateRiskMetric[]): GateRiskState {
  if (gates.every((gate) => gate.state === "passed")) return "passed";
  const worst = [...gates].sort((left, right) => ACTIVE_SEVERITY[right.state] - ACTIVE_SEVERITY[left.state])[0];
  return worst?.state === "not-started" ? "normal" : worst?.state ?? "normal";
}

function projectRisk(
  project: ProjectRecord,
  tasks: TaskRecord[],
  options: GateRiskOptions
): ProjectGateRisk {
  const stageIds = options.settings.stages.map((stage) => stage.id);
  const schedule = options.gateSchedules[project.id];
  if (!validateGateSchedule(schedule, stageIds).valid || !schedule) {
    return { project, configured: false, state: "unconfigured", gates: [], nearestGate: null };
  }
  const progress = aggregateDeliveryProgress(tasks, {
    projectIds: new Set([project.id]),
    includeArchived: options.includeArchived,
    settings: options.settings
  });
  const gates: GateRiskMetric[] = [];
  let windowStart = schedule.startDate;
  let previousGatesPassed = true;
  for (const [index, stage] of options.settings.stages.entries()) {
    const metric = progress.stages[index];
    if (!metric) continue;
    const gateDate = schedule.stageGates[stage.id] ?? "";
    const progressValue = metric.state === "skipped" ? 100 : metric.percentage ?? 0;
    const gate = assessGate({
      id: stage.id,
      name: stage.name,
      kind: "stage",
      windowStart,
      gateDate,
      today: options.today,
      progress: progressValue,
      tasks: metric.tasks,
      passed: metric.state === "skipped" || progressValue === 100,
      skipped: metric.state === "skipped",
      previousGatesPassed
    });
    gates.push(gate);
    previousGatesPassed = previousGatesPassed && gate.state === "passed";
    windowStart = gateDate;
  }

  const acceptanceTasks = progress.acceptance.roots
    .filter((root) => root.state !== "accepted")
    .map((root) => root.task);
  const acceptanceBlockers = progress.acceptance.roots.flatMap((root) => root.blockers);
  const acceptanceRiskTasks = uniqueTasks(progress.acceptance.roots.flatMap((root) => [
    root.task,
    ...root.prerequisites
  ]));
  const acceptanceProgress = progress.acceptance.percentage ?? 0;
  const acceptance = assessGate({
    id: "acceptance",
    name: "",
    kind: "acceptance",
    windowStart,
    gateDate: schedule.acceptanceGate,
    today: options.today,
    progress: acceptanceProgress,
    tasks: acceptanceRiskTasks,
    blockingTasks: acceptanceBlockers,
    passed: progress.acceptance.total > 0 && acceptanceProgress === 100,
    previousGatesPassed
  });
  acceptance.tasks = acceptanceTasks;
  gates.push(acceptance);

  const projectRiskTasks = uniqueTasks([
    ...progress.stages.flatMap((stage) => stage.tasks),
    ...progress.acceptance.roots.map((root) => root.task)
  ]);
  const launch = assessGate({
    id: "launch",
    name: "",
    kind: "launch",
    windowStart: schedule.startDate,
    gateDate: schedule.launchDate,
    today: options.today,
    progress: progress.totalPercentage ?? 0,
    tasks: projectRiskTasks,
    blockingTasks: acceptanceBlockers,
    timingTasks: acceptanceRiskTasks,
    passed: progress.acceptance.total > 0 && acceptanceProgress === 100,
  });
  gates.push(launch);

  const nearestGate = gates
    .filter((gate) => gate.state !== "passed")
    .sort((left, right) => Math.abs(left.daysRemaining) - Math.abs(right.daysRemaining)
      || left.gateDate.localeCompare(right.gateDate))[0] ?? null;
  return {
    project,
    configured: true,
    state: projectState(gates),
    gates,
    nearestGate
  };
}

export function aggregateGateRisk(
  projects: ProjectRecord[],
  tasks: TaskRecord[],
  options: GateRiskOptions
): GateRiskSnapshot {
  const selected = projects.filter((project) => options.projectIds.has(project.id));
  const projectRisks = selected.map((project) => projectRisk(project, tasks, options));
  const counts: GateRiskSnapshot["counts"] = {
    unconfigured: 0,
    normal: 0,
    attention: 0,
    high: 0,
    overdue: 0,
    passed: 0
  };
  for (const risk of projectRisks) counts[risk.state === "not-started" ? "normal" : risk.state] += 1;
  const nearest = projectRisks.flatMap((risk) => risk.nearestGate
    ? [{ project: risk.project, gate: risk.nearestGate }]
    : []
  ).sort((left, right) => Math.abs(left.gate.daysRemaining) - Math.abs(right.gate.daysRemaining)
    || left.gate.gateDate.localeCompare(right.gate.gateDate))[0] ?? null;
  return { today: options.today, projects: projectRisks, counts, nearestGate: nearest };
}
