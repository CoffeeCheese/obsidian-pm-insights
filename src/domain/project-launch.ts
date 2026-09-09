import { reconcileProjectGateActuals, emptyActualState } from "./gate-delay";
import { isDateOnly, validateGateSchedule } from "./gate-schedule";
import { scheduleDaysBetween } from "./schedule-calendar";
import type {
  DeliveryProgressSettings, GateActualEvent, GateDelayStatus,
  ProjectGateActualState, ProjectGateDelayPlan, ProjectGateSchedule, TaskRecord
} from "../model";

export type LaunchCommand =
  | { kind: "confirm"; date: string }
  | { kind: "correct"; date: string; reason: string }
  | { kind: "revoke"; reason: string };

export type LaunchRejection = "schedule-invalid" | "acceptance-pending"
  | "delay-draft-pending" | "invalid-date" | "reason-required"
  | "already-launched" | "not-launched" | "history-incomplete";

export interface LaunchContext {
  projectId: string;
  tasks: TaskRecord[];
  settings: DeliveryProgressSettings;
  includeArchived: boolean;
  schedule: ProjectGateSchedule | undefined;
  actuals: ProjectGateActualState | undefined;
  delay: ProjectGateDelayPlan | undefined;
  today: string;
  now: string;
}

export interface LaunchProjection {
  state: "blocked" | "ready" | "launched";
  blocker: LaunchRejection | null;
  date: string | null;
  acceptanceDate: string | null;
  baselineDate: string | null;
  forecastDate: string | null;
  baselineVariance: number | null;
  forecastVariance: number | null;
  includeWeekends: boolean;
  openTaskCount: number;
}

export type LaunchDecision =
  | { kind: "rejected"; reason: LaunchRejection }
  | { kind: "unchanged" }
  | {
      kind: "changed";
      next: { actuals: ProjectGateActualState; delay: ProjectGateDelayPlan | undefined };
      feedback: "confirmed" | "corrected" | "revoked";
    };

function currentLaunchEvent(actuals: ProjectGateActualState | undefined): GateActualEvent | undefined {
  for (const event of [...(actuals?.events ?? [])].reverse()) {
    if (event.kind === "launch-revoked") return undefined;
    if (event.kind === "launch") return event;
  }
  return undefined;
}

function reconciled(context: LaunchContext): ProjectGateActualState {
  return reconcileProjectGateActuals({ ...context, previous: context.actuals }).state;
}

function validDate(date: string | undefined): string | null {
  return date && isDateOnly(date) ? date : null;
}

export function projectLaunchState(context: LaunchContext): LaunchProjection {
  const date = validDate(context.actuals?.launchDate);
  const actuals = date ? context.actuals : reconciled(context);
  const acceptance = actuals?.gates.acceptance;
  const acceptanceDate = date
    ? validDate(currentLaunchEvent(actuals)?.acceptanceDateAtLaunch)
      ?? validDate(acceptance?.date)
    : acceptance?.open === false ? validDate(acceptance.date) : null;
  const baselineDate = validDate(context.schedule?.launchDate);
  const forecastDate = validDate(context.delay?.confirmed?.launchDate);
  const includeWeekends = context.schedule?.includeWeekends !== false;
  const blocker: LaunchRejection | null = date ? null
    : !validateGateSchedule(context.schedule, context.settings.stages.map((stage) => stage.id)).valid
      ? "schedule-invalid"
      : context.delay?.draft ? "delay-draft-pending"
        : !acceptanceDate ? "acceptance-pending" : null;
  return {
    state: date ? "launched" : blocker ? "blocked" : "ready",
    blocker, date, acceptanceDate, baselineDate, forecastDate, includeWeekends,
    baselineVariance: date && baselineDate ? scheduleDaysBetween(baselineDate, date, includeWeekends) : null,
    forecastVariance: date && forecastDate ? scheduleDaysBetween(forecastDate, date, includeWeekends) : null,
    openTaskCount: context.tasks.filter((task) => task.projectId === context.projectId
      && !task.completed && !task.archived
      && !["cancelled", "canceled"].includes(task.status.toLowerCase())).length
  };
}

function restoredDelayStatus(context: LaunchContext): GateDelayStatus | null | undefined {
  const original = currentLaunchEvent(context.actuals)?.delayStatusBeforeLaunch;
  if (original !== undefined) return original;
  const plan = context.delay;
  if (!plan) return null;
  if (plan.draft) return undefined;
  if (plan.status !== "completed") return plan.status;
  const withdrawn = new Set(plan.revisions.flatMap((revision) => revision.kind === "withdrawn"
    && revision.targetRevisionId ? [revision.targetRevisionId] : []));
  const decisions = plan.revisions.filter((revision) => !revision.withdrawnAt && !withdrawn.has(revision.id)
    && ["confirmed", "resolved", "restored"].includes(revision.kind));
  const last = decisions.at(-1);
  if (last?.kind === "confirmed" && plan.confirmed) return "confirmed";
  if ((last?.kind === "resolved" || last?.kind === "restored") && !plan.confirmed) return last.kind;
  if (!last && !plan.confirmed && plan.revisions.some((revision) => revision.withdrawnAt
      || revision.kind === "withdrawn")) return "withdrawn";
  return undefined;
}

export function decideProjectLaunch(context: LaunchContext, command: LaunchCommand): LaunchDecision {
  const projection = projectLaunchState(context);
  const reject = (reason: LaunchRejection): LaunchDecision => ({ kind: "rejected", reason });
  if (command.kind === "confirm" && projection.date) {
    return command.date === projection.date ? { kind: "unchanged" } : reject("already-launched");
  }
  if (command.kind !== "confirm" && !projection.date) return reject("not-launched");
  if (command.kind === "confirm" && projection.blocker) return reject(projection.blocker);
  if (command.kind !== "confirm" && !command.reason.trim()) return reject("reason-required");
  if (command.kind !== "revoke") {
    if (!isDateOnly(command.date) || command.date > context.today
        || (projection.acceptanceDate && command.date < projection.acceptanceDate)) return reject("invalid-date");
    if (command.date === projection.date) return { kind: "unchanged" };
  }
  const restored = command.kind === "revoke" ? restoredDelayStatus(context) : undefined;
  if (command.kind === "revoke" && (restored === undefined
      || (context.delay && restored === null) || (!context.delay && restored !== null))) {
    return reject("history-incomplete");
  }
  const actuals = structuredClone(command.kind === "confirm"
    ? reconciled(context) : context.actuals ?? emptyActualState());
  const delay = context.delay ? structuredClone(context.delay) : undefined;
  const launch = currentLaunchEvent(actuals);
  const event: GateActualEvent = {
    id: `${context.now}:launch:${actuals.events.length + 1}`,
    createdAt: context.now,
    kind: command.kind === "confirm" ? "launch" : command.kind === "correct" ? "launch-corrected" : "launch-revoked",
    gateId: "launch", source: "manual",
    ...(projection.date ? { previousDate: projection.date } : {}),
    ...(command.kind !== "confirm" ? { reason: command.reason.trim() } : {}),
    ...(launch ? { targetEventId: launch.id } : {})
  };
  if (command.kind === "revoke") {
    delete actuals.launchDate;
    delete actuals.launchRecordedAt;
    if (delay && restored) delay.status = restored;
  } else {
    actuals.launchDate = command.date;
    actuals.launchRecordedAt = context.now;
    event.date = command.date;
    if (command.kind === "confirm") {
      if (projection.acceptanceDate) event.acceptanceDateAtLaunch = projection.acceptanceDate;
      event.delayStatusBeforeLaunch = delay?.status ?? null;
    }
    if (delay) delay.status = "completed";
  }
  actuals.events.push(event);
  return {
    kind: "changed", next: { actuals, delay },
    feedback: command.kind === "confirm" ? "confirmed" : command.kind === "correct" ? "corrected" : "revoked"
  };
}
