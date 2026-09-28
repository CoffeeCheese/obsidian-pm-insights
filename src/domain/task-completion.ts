function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function completionDate(value: string | null | undefined): { date: string; time: string | null; instant: number | null } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})?)?$/i.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (daysInMonth[month - 1] ?? 0)) return null;
  const date = `${yearText}-${monthText}-${dayText}`;
  if (hourText === undefined) return { date, time: null, instant: null };
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText ?? "0");
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (zone && zone.toUpperCase() !== "Z") {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return null;
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const local = new Date(instant);
  if (!zone && (localDate(local) !== date || local.getHours() !== hour
    || local.getMinutes() !== minute || local.getSeconds() !== second)) return null;
  return {
    date: localDate(local),
    time: `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`,
    instant
  };
}
