import { DEFAULT_TIMEZONE } from '@revops/shared';

/** The hour (0–23) of `now` in `timeZone`. */
function localHour(now: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone })
    .formatToParts(now)
    .find((p) => p.type === 'hour')?.value;
  return Number(hour ?? 0);
}

/** "Good morning" (5–11), "Good afternoon" (12–16), else "Good evening" — tenant-local. */
export function greeting(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const hour = localHour(now, timeZone);
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "Wednesday, 19 November" in the tenant timezone. */
export function longDate(now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(now);
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then the date. */
export function timeAgo(iso: string, now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(iso),
  );
}

/** Bar width in percent of the largest value; a non-zero value is never thinner than 4%. */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}

/** First letters of up to two words ("Asha Verma" → "AV"). */
export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}
