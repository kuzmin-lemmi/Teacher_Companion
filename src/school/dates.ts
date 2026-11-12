const WEEKDAYS = [
  'воскресенье',
  'понедельник',
  'вторник',
  'среда',
  'четверг',
  'пятница',
  'суббота',
];
const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «2026-11-13» + 3 → «2026-11-16». */
export function addDays(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

/** 1 = понедельник … 7 = воскресенье. */
export function weekdayOf(iso: string): number {
  const g = parseIso(iso).getDay();
  return g === 0 ? 7 : g;
}

/** «пятница, 13 ноября» */
export function dateLabel(iso: string): string {
  const d = parseIso(iso);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Следующий учебный день после `from` (замены обычно печатают на завтра). */
export function nextSchoolDay(from: Date, dayCount: number): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  for (let i = 0; i < 7; i++) {
    const w = d.getDay() === 0 ? 7 : d.getDay();
    if (w <= dayCount) break;
    d.setDate(d.getDate() + 1);
  }
  return toIso(d);
}
