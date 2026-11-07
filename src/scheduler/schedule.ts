export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

export function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
  let utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const zoned = zonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const delta = target - asUtc;
    if (delta === 0) break;
    utc += delta;
  }
  return new Date(utc);
}

function addDays(parts: ZonedParts, days: number): ZonedParts {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: 0,
  };
}

export function nextDailyRun(from: Date, timeZone: string, dailyAt: string): Date {
  const [hourText, minuteText] = dailyAt.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const current = zonedParts(from, timeZone);
  let target: ZonedParts = { ...current, hour, minute, second: 0 };
  const alreadyPast = current.hour > hour || (current.hour === hour && current.minute >= minute);
  if (alreadyPast) target = addDays(target, 1);
  return zonedTimeToUtc(target, timeZone);
}

export function cronLine(dailyAt: string, timeZone: string, command: string): string {
  const [hour, minute] = dailyAt.split(":");
  return `CRON_TZ=${timeZone}\n${Number(minute)} ${Number(hour)} * * * ${command}`;
}
