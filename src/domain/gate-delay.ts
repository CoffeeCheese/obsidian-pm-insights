import { aggregateDeliveryProgress } from "./delivery-progress";
import { isDateOnly, validateGateSchedule } from "./gate-schedule";
import { scheduleDaysBetween } from "./schedule-calendar";
import type {
  DeliveryProgressSettings,
  GateActualDateSource,
  GateActualEvent,
  GateDelayRevision,
  ProjectGateActualState,
  ProjectGateDelayPlan,
  ProjectGateForecast,
  ProjectGateSchedule,
  TaskRecord
} from "../model";

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACCEPTANCE_GATE_ID = "acceptance";
export const LAUNCH_GATE_ID = "launch";

export interface GateForecastValidation {
  valid: boolean;
  missing: string[];
  invalid: string[];
  beforeBaseline: string[];
  inPast: string[];
  outOfOrder: boolean;
}

export interface GateActualReconciliation {
  state: ProjectGateActualState;
  changed: boolean;
}

export interface GateBaselineEditPolicy {
  canEditDates: boolean;
  canEditCalendarRule: boolean;
  canSave: boolean;
}

export function emptyActualState(): ProjectGateActualState {
  return { gates: {}, events: [] };
}

export function forecastFromSchedule(schedule: ProjectGateSchedule): ProjectGateForecast {
  return {
    stageGates: structuredClone(schedule.stageGates),
    acceptanceGate: schedule.acceptanceGate,
    launchDate: schedule.launchDate
  };
}

export function cloneForecast(forecast: ProjectGateForecast): ProjectGateForecast {
  return structuredClone(forecast);
}

export function delayPlanLocksBaseline(plan: ProjectGateDelayPlan | undefined): boolean {
  return (plan?.revisions.length ?? 0) > 0;
}

export function gateBaselineEditPolicy(
  plan: ProjectGateDelayPlan | undefined
): GateBaselineEditPolicy {
  return {
    canEditDates: !delayPlanLocksBaseline(plan),
    canEditCalendarRule: true,
    canSave: true
  };
}

function withdrawnRevisionIds(revisions: readonly GateDelayRevision[]): Set<string> {
  return new Set(revisions.flatMap((revision) => {
    if (revision.withdrawnAt) return [revision.id];
    if (revision.kind === "withdrawn" && revision.targetRevisionId) {
      return [revision.targetRevisionId];
    }
    return [];
  }));
}

export function withdrawableDelayRevision(
  plan: ProjectGateDelayPlan | undefined
): GateDelayRevision | undefined {
  if (!plan || plan.status === "completed") return undefined;
  const withdrawn = withdrawnRevisionIds(plan.revisions);
  if (plan.draft) {
    for (let index = plan.revisions.length - 1; index >= 0; index -= 1) {
      const revision = plan.revisions[index];
      if (!revision || revision.kind === "withdrawn" || withdrawn.has(revision.id)) continue;
      if (revision.kind === "evaluation") return revision;
      if (["confirmed", "resolved", "restored"].includes(revision.kind)) return undefined;
    }
    return undefined;
  }
  if (!plan.confirmedRevisionId) return undefined;
  const revision = plan.revisions.find((candidate) =>
    candidate.id === plan.confirmedRevisionId
      && candidate.kind === "confirmed"
      && !withdrawn.has(candidate.id)
  );
  return revision;
}

function rollbackDelayRevision(
  plan: ProjectGateDelayPlan,
  revisionId: string
): ProjectGateDelayPlan | undefined {
  const target = withdrawableDelayRevision(plan);
  if (!target || target.id !== revisionId) return undefined;
  const next = structuredClone(plan);
  const targetIndex = next.revisions.findIndex((revision) => revision.id === revisionId);
  if (targetIndex < 0) return undefined;
  const withdrawn = withdrawnRevisionIds(next.revisions);
  withdrawn.add(revisionId);

  if (target.kind === "evaluation") {
    let previous: GateDelayRevision | undefined;
    for (let index = targetIndex - 1; index >= 0; index -= 1) {
      const revision = next.revisions[index];
      if (!revision || revision.kind === "withdrawn" || withdrawn.has(revision.id)) continue;
      if (revision.kind === "evaluation") {
        previous = revision;
        break;
      }
      if (["confirmed", "resolved", "restored"].includes(revision.kind)) break;
    }
    if (previous) {
      next.draft = cloneForecast(previous.forecast);
      next.status = "evaluating";
    } else {
      delete next.draft;
      next.status = next.confirmed ? "confirmed" : "withdrawn";
    }
    return next;
  }

  delete next.draft;
  let confirmed: GateDelayRevision | undefined;
  for (const revision of next.revisions.slice(0, targetIndex)) {
    if (revision.kind === "withdrawn" || withdrawn.has(revision.id)) continue;
    if (revision.kind === "confirmed") confirmed = revision;
    else if (revision.kind === "resolved" || revision.kind === "restored") confirmed = undefined;
  }
  if (confirmed) {
    next.confirmed = cloneForecast(confirmed.forecast);
    next.confirmedRevisionId = confirmed.id;
    next.status = "confirmed";
  } else {
    delete next.confirmed;
    delete next.confirmedRevisionId;
    next.status = "withdrawn";
  }
  return next;
}

export function withdrawDelayRevision(
  plan: ProjectGateDelayPlan,
  revisionId: string,
  withdrawnAt: string
): ProjectGateDelayPlan | undefined {
  const next = rollbackDelayRevision(plan, revisionId);
  const target = next?.revisions.find((revision) => revision.id === revisionId);
  if (!next || !target) return undefined;
  target.withdrawnAt = withdrawnAt;
  return next;
}

export function effectiveGateSchedule(
  baseline: ProjectGateSchedule,
  plan: ProjectGateDelayPlan | undefined
): ProjectGateSchedule {
  const forecast = plan?.confirmed;
  if (!forecast) return baseline;
  return {
    ...baseline,
    stageGates: structuredClone(forecast.stageGates),
    acceptanceGate: forecast.acceptanceGate,
    launchDate: forecast.launchDate
  };
}

export function gateForecastDate(forecast: ProjectGateForecast, gateId: string): string {
  if (gateId === ACCEPTANCE_GATE_ID) return forecast.acceptanceGate;
  if (gateId === LAUNCH_GATE_ID) return forecast.launchDate;
  return forecast.stageGates[gateId] ?? "";
}

export function setGateForecastDate(
  forecast: ProjectGateForecast,
  gateId: string,
  date: string
): void {
  if (gateId === ACCEPTANCE_GATE_ID) forecast.acceptanceGate = date;
  else if (gateId === LAUNCH_GATE_ID) forecast.launchDate = date;
  else forecast.stageGates[gateId] = date;
}

export function baselineGateDate(schedule: ProjectGateSchedule, gateId: string): string {
  if (gateId === ACCEPTANCE_GATE_ID) return schedule.acceptanceGate;
  if (gateId === LAUNCH_GATE_ID) return schedule.launchDate;
  return schedule.stageGates[gateId] ?? "";
}

export function gateDelayDays(
  baseline: ProjectGateSchedule,
  forecast: ProjectGateForecast,
  gateId: string
): number {
  return scheduleDaysBetween(
    baselineGateDate(baseline, gateId),
    gateForecastDate(forecast, gateId),
    baseline.includeWeekends
  );
}

export function actualGateDelayDays(
  baseline: ProjectGateSchedule,
  actualDate: string,
  gateId: string
): number {
  return scheduleDaysBetween(
    baselineGateDate(baseline, gateId),
    actualDate,
    baseline.includeWeekends
  );
}

export function gateForecastDateFromDelay(
  baseline: ProjectGateSchedule,
  gateId: string,
  delayDays: number
): string {
  return addScheduleDays(
    baselineGateDate(baseline, gateId),
    delayDays,
    baseline.includeWeekends
  );
}

export function forecastVarianceDays(
  baseline: ProjectGateSchedule,
  forecast: ProjectGateForecast,
  actualDate: string,
  gateId: string
): number {
  return scheduleDaysBetween(
    gateForecastDate(forecast, gateId),
    actualDate,
    baseline.includeWeekends
  );
}

export function forecastHasDelay(
  baseline: ProjectGateSchedule,
  forecast: ProjectGateForecast,
  stageIds: readonly string[],
  actuals?: ProjectGateActualState
): boolean {
  return [...stageIds, ACCEPTANCE_GATE_ID, LAUNCH_GATE_ID]
    .filter((gateId) => gateId === LAUNCH_GATE_ID
      ? !actuals?.launchDate
      : actuals?.gates[gateId]?.open !== false
    )
    .some((gateId) => gateDelayDays(baseline, forecast, gateId) > 0);
}

export function addScheduleDays(
  value: string,
  days: number,
  includeWeekends: boolean
): string {
  if (!isDateOnly(value) || days === 0) return value;
  const date = new Date(`${value}T00:00:00.000Z`);
  const direction = days < 0 ? -1 : 1;
  let remaining = Math.abs(days);
  while (remaining > 0) {
    date.setTime(date.getTime() + direction * DAY_MS);
    const weekday = date.getUTCDay();
    if (includeWeekends || (weekday !== 0 && weekday !== 6)) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export function validateGateForecast(
  baseline: ProjectGateSchedule,
  forecast: ProjectGateForecast,
  stageIds: readonly string[],
  actuals: ProjectGateActualState | undefined,
  today: string
): GateForecastValidation {
  const ids = [...stageIds, ACCEPTANCE_GATE_ID, LAUNCH_GATE_ID];
  const values = ids.map((gateId) => ({ gateId, value: gateForecastDate(forecast, gateId) }));
  const missing = values.filter(({ value }) => !value).map(({ gateId }) => gateId);
  const invalid = values.filter(({ value }) => value && !isDateOnly(value)).map(({ gateId }) => gateId);
  const beforeBaseline = values.flatMap(({ gateId, value }) => {
    const actual = actuals?.gates[gateId];
    if (actual && !actual.open) return [];
    return isDateOnly(value) && value < baselineGateDate(baseline, gateId) ? [gateId] : [];
  });
  const inPast = values.flatMap(({ gateId, value }) => {
    const actual = gateId === LAUNCH_GATE_ID
      ? actuals?.launchDate
      : actuals?.gates[gateId]?.open === false
        ? actuals.gates[gateId]?.date
        : undefined;
    return !actual && isDateOnly(value) && value < today ? [gateId] : [];
  });
  const orderedValues = [baseline.startDate, ...values.map(({ value }) => value)];
  const outOfOrder = orderedValues.some((value, index) => {
    const previous = orderedValues[index - 1];
    return Boolean(previous && isDateOnly(previous) && isDateOnly(value) && value < previous);
  });
  return {
    valid: missing.length === 0
      && invalid.length === 0
      && beforeBaseline.length === 0
      && inPast.length === 0
      && !outOfOrder,
    missing,
    invalid,
    beforeBaseline,
    inPast,
    outOfOrder
  };
}

function taskDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return isDateOnly(date) ? date : null;
}

function reliableCompletionDate(tasks: TaskRecord[]): string | null {
  if (tasks.length === 0 || tasks.some((task) => !task.completed)) return null;
  const dates = tasks.map((task) => taskDate(task.completedAt));
  if (dates.some((date) => date === null)) return null;
  return dates.filter((date): date is string => date !== null).sort().at(-1) ?? null;
}

function event(
  state: ProjectGateActualState,
  now: string,
  kind: GateActualEvent["kind"],
  gateId: string,
  fields: Omit<GateActualEvent, "id" | "createdAt" | "kind" | "gateId"> = {}
): GateActualEvent {
  return {
    id: `${now}:${kind}:${gateId}:${state.events.length + 1}`,
    createdAt: now,
    kind,
    gateId,
    ...fields
  };
}

function maxDate(...values: Array<string | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? "";
}

function reconcilePass(
  state: ProjectGateActualState,
  gateId: string,
  qualifies: boolean,
  skipped: boolean,
  tasks: TaskRecord[],
  previousDate: string,
  today: string,
  now: string
): boolean {
  const current = state.gates[gateId];
  if (!qualifies || skipped) {
    if (!current || current.open) return false;
    current.open = true;
    state.events.push(event(state, now, "reopened", gateId, {
      previousDate: current.date,
      source: current.source
    }));
    return true;
  }

  const reliable = reliableCompletionDate(tasks);
  const source: GateActualDateSource = reliable ? "tasks" : "observed";
  const nextDate = maxDate(reliable ?? today, previousDate);
  if (!current || current.open) {
    state.gates[gateId] = { date: nextDate, source, recordedAt: now, open: false };
    state.events.push(event(state, now, "passed", gateId, { date: nextDate, source }));
    return true;
  }

  if (reliable && (current.source !== "tasks" || current.date !== nextDate)) {
    const previous = current.date;
    current.date = nextDate;
    current.source = "tasks";
    current.recordedAt = now;
    state.events.push(event(state, now, "corrected", gateId, {
      date: nextDate,
      previousDate: previous,
      source: "tasks"
    }));
    return true;
  }
  return false;
}

export function reconcileProjectGateActuals(input: {
  projectId: string;
  tasks: TaskRecord[];
  settings: DeliveryProgressSettings;
  includeArchived: boolean;
  schedule: ProjectGateSchedule | undefined;
  previous: ProjectGateActualState | undefined;
  today: string;
  now: string;
}): GateActualReconciliation {
  const { schedule, settings } = input;
  if (!schedule || !validateGateSchedule(schedule, settings.stages.map((stage) => stage.id)).valid) {
    return { state: input.previous ?? emptyActualState(), changed: false };
  }
  const state = structuredClone(input.previous ?? emptyActualState());
  let changed = false;
  const progress = aggregateDeliveryProgress(input.tasks, {
    projectIds: new Set([input.projectId]),
    includeArchived: input.includeArchived,
    settings
  });
  let previousPassed = true;
  let previousDate = schedule.startDate;

  for (const [index, stage] of settings.stages.entries()) {
    const metric = progress.stages[index];
    if (!metric) continue;
    const skipped = metric.state === "skipped";
    const complete = !skipped && metric.percentage === 100;
    const qualifies: boolean = complete && previousPassed;
    changed = reconcilePass(
      state,
      stage.id,
      qualifies,
      skipped,
      metric.tasks,
      previousDate,
      input.today,
      input.now
    ) || changed;
    const actual = state.gates[stage.id];
    previousPassed = skipped || (qualifies && actual?.open === false);
    if (!skipped && previousPassed && actual) previousDate = actual.date;
  }

  const acceptanceTasks = [...new Map(progress.acceptance.roots.flatMap((root) => [
    root.task,
    ...root.prerequisites
  ]).map((task) => [task.id, task])).values()];
  const acceptanceComplete = progress.acceptance.total > 0
    && progress.acceptance.percentage === 100;
  const acceptanceQualifies = acceptanceComplete && previousPassed;
  changed = reconcilePass(
    state,
    ACCEPTANCE_GATE_ID,
    acceptanceQualifies,
    false,
    acceptanceTasks,
    previousDate,
    input.today,
    input.now
  ) || changed;

  return { state, changed };
}
