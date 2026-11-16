export type CronSlot = { minute: number; hour: number; weekday: number };

const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** shortcut: only `minute hour * * weekday` (0-7 or sun-sat). Other cron fields are rejected. */
export function parseCron(input: string | undefined): CronSlot | undefined {
  if (!input?.trim()) return undefined;
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 5 || parts[2] !== '*' || parts[3] !== '*') return undefined;
  const minute = parseNumber(parts[0], 0, 59);
  const hour = parseNumber(parts[1], 0, 23);
  const weekday = parseWeekday(parts[4]);
  if (minute === undefined || hour === undefined || weekday === undefined) return undefined;
  return { minute, hour, weekday };
}

export function zonedClock(
  date: Date,
  timeZone: string,
): { minute: number; hour: number; weekday: number; key: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = DAYS[pick('weekday').slice(0, 3).toLowerCase()];
  const hour = Number(pick('hour'));
  const minute = Number(pick('minute'));
  return {
    weekday,
    hour,
    minute,
    key: `${pick('year')}-${pick('month')}-${pick('day')}`,
  };
}

export function isScheduleDue(
  slot: CronSlot,
  now: Date,
  timeZone: string,
  lastKey: string | undefined,
): { due: boolean; key: string } {
  const clock = zonedClock(now, timeZone);
  const key = `${clock.key}T${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`;
  const due =
    clock.minute === slot.minute &&
    clock.hour === slot.hour &&
    clock.weekday === slot.weekday &&
    lastKey !== key;
  return { due, key };
}

export const DEFAULT_WEEKLY_CRON = '0 20 * * 0';
export const DUBAI = 'Asia/Dubai';

function parseNumber(value: string | undefined, min: number, max: number): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  if (n < min || n > max) return undefined;
  return n;
}

function parseWeekday(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const named = DAYS[value.toLowerCase()];
  if (named !== undefined) return named;
  const n = parseNumber(value, 0, 7);
  if (n === 7) return 0;
  return n;
}
