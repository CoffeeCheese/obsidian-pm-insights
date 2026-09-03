const DAY_MS = 86_400_000;

function dateValue(value: string): number {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isWeekend(value: number): boolean {
  const day = new Date(value).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Counts elapsed schedule days in the half-open boundary `(from, to]`.
 * When weekends are excluded, moving across Saturday or Sunday does not
 * advance the project clock.
 */
export function scheduleDaysBetween(
  from: string,
  to: string,
  includeWeekends: boolean
): number {
  const fromValue = dateValue(from);
  const toValue = dateValue(to);
  if (fromValue === toValue) return 0;

  const direction = fromValue < toValue ? 1 : -1;
  const start = direction === 1 ? fromValue : toValue;
  const end = direction === 1 ? toValue : fromValue;
  if (includeWeekends) return direction * Math.round((end - start) / DAY_MS);

  let days = 0;
  for (let cursor = start + DAY_MS; cursor <= end; cursor += DAY_MS) {
    if (!isWeekend(cursor)) days += 1;
  }
  return direction * days;
}

/**
 * Counts usable days in one delivery-stage window.
 *
 * Normal windows retain the project clock's `(from, to]` semantics. A project
 * may explicitly treat two gates on the same eligible date as one full day of
 * capacity, without changing elapsed, delay, overdue, or remaining-day clocks.
 */
export function stageWindowDaysBetween(
  from: string,
  to: string,
  includeWeekends: boolean,
  countSameDayGateAsDay: boolean
): number {
  if (from !== to || !countSameDayGateAsDay) {
    return scheduleDaysBetween(from, to, includeWeekends);
  }
  return includeWeekends || !isWeekend(dateValue(to)) ? 1 : 0;
}
