import type { DeliveryStageId, ProjectGateSchedule } from "../model";

export interface GateScheduleValidation {
  valid: boolean;
  missing: string[];
  invalid: string[];
  outOfOrder: boolean;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateGateSchedule(
  schedule: ProjectGateSchedule | undefined,
  stageIds: readonly DeliveryStageId[]
): GateScheduleValidation {
  const entries = [
    { key: "start", value: schedule?.startDate ?? "" },
    ...stageIds.map((stageId) => ({ key: stageId, value: schedule?.stageGates[stageId] ?? "" })),
    { key: "acceptance", value: schedule?.acceptanceGate ?? "" },
    { key: "launch", value: schedule?.launchDate ?? "" }
  ];
  const missing = entries.filter((entry) => !entry.value).map((entry) => entry.key);
  const invalid = entries
    .filter((entry) => entry.value && !isDateOnly(entry.value))
    .map((entry) => entry.key);
  const comparable = entries.filter((entry) => isDateOnly(entry.value));
  const outOfOrder = comparable.some((entry, index) => {
    const previous = comparable[index - 1];
    if (!previous) return false;
    return entries.indexOf(entry) === entries.indexOf(previous) + 1 && entry.value < previous.value;
  });
  return {
    valid: missing.length === 0 && invalid.length === 0 && !outOfOrder,
    missing,
    invalid,
    outOfOrder
  };
}
