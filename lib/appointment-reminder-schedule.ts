const BUSINESS_TIME_ZONE = "America/Los_Angeles";

function dateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function nextBusinessDateKey(now = new Date()) {
  const today = dateKey(now);
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10);
}

export function appointmentFallsOnBusinessDate(scheduledStart: string, targetDate: string) {
  const start = new Date(scheduledStart);
  return !Number.isNaN(start.getTime()) && dateKey(start) === targetDate;
}
