/**
 * Расписание своего класса текстом для чата родителей и учеников (Max, Telegram, WhatsApp).
 * Простой текст с эмодзи, без Markdown: звёздочки в чатах могли бы остаться видны.
 *
 * Работает и в школьном режиме (уроки класса и замены по датам — от завуча), и с «Моим классом»,
 * заполненным вручную. Учитываются каникулы и сокращённые дни.
 */
import {
  classWeek,
  dayOff,
  isoDate,
  schoolClassDay,
  timeOf,
  type AppData,
  type DayOff,
  type Lesson,
} from './domain';

export type ClassTextOptions = { rooms: boolean; teachers: boolean };
export type ClassLine = {
  lessonNumber: number;
  start?: string;
  end?: string;
  subject: string;
  room: string;
  teacher: string;
};
export type ClassDay = { date: Date; off?: DayOff; short: boolean; lines: ClassLine[] };

const weekdayLong = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** «пятница, 14 ноября» */
export const dayLabel = (d: Date) => `${weekdayLong.format(d)}, ${dayMonth.format(d)}`;

export const homeroomName = (data: AppData) =>
  (data.homeroom?.enabled && data.homeroom.className.trim()) || '';

/** Уроки класса на дату: замены от школы, иначе обычная неделя класса. */
export function classDay(data: AppData, date: Date): ClassDay {
  const key = isoDate(date);
  const off = dayOff(data, date);
  const short = data.shortDays.includes(key) && data.shortBells.length > 0;
  if (off || !homeroomName(data)) return { date, off, short, lines: [] };
  const wd = date.getDay();
  const list =
    schoolClassDay(data, key, homeroomName(data)) ??
    classWeek(data).filter((l) => l.weekday === wd);
  const shortBells = short ? data.shortBells : [];
  const lines = [...list]
    .sort((a, b) => a.lessonNumber - b.lessonNumber)
    .map((l) => {
      const time = timeOf({ lessonNumber: l.lessonNumber } as Lesson, data.bells, shortBells);
      return {
        lessonNumber: l.lessonNumber,
        ...(time ? { start: time.start, end: time.end } : {}),
        subject: l.subject.trim() || '—',
        room: l.room.trim(),
        teacher: l.teacher.trim(),
      };
    });
  return { date, off, short, lines };
}

function lineText(l: ClassLine, o: ClassTextOptions) {
  const time = l.start && l.end ? ` ${l.start}–${l.end}` : '';
  const room = o.rooms && l.room ? (/^\d/.test(l.room) ? `каб. ${l.room}` : l.room) : '';
  const extra = [room, o.teachers ? l.teacher : ''].filter(Boolean).join(', ');
  return `${l.lessonNumber}.${time} ${l.subject}${extra ? `, ${extra}` : ''}`;
}

const lastEnd = (d: ClassDay) => [...d.lines].reverse().find((l) => l.end)?.end;

/** «📅 8Г — пятница, 14 ноября» и уроки по порядку; в конце — когда заканчиваются уроки. */
export function classDayText(data: AppData, date: Date, o: ClassTextOptions): string {
  const d = classDay(data, date);
  const out = [`📅 ${homeroomName(data)} — ${dayLabel(date)}`, ''];
  if (d.off) out.push(`Уроков нет: ${d.off.title || 'выходной'}`);
  else if (!d.lines.length) out.push('Уроков нет');
  else {
    if (d.short) out.push('⏱ Сокращённые уроки', '');
    out.push(...d.lines.map((l) => lineText(l, o)));
    const end = lastEnd(d);
    if (end) out.push('', `🔔 Уроки заканчиваются в ${end}`);
  }
  return out.join('\n');
}

/** Неделя пн–пт, начиная с `monday`: по дню на абзац. */
export function classWeekText(data: AppData, monday: Date, o: ClassTextOptions): string {
  const days = [0, 1, 2, 3, 4].map((i) =>
    classDay(data, new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)),
  );
  const first = days[0].date;
  const last = days[4].date;
  const range =
    first.getMonth() === last.getMonth()
      ? `${first.getDate()}–${dayMonth.format(last)}`
      : `${dayMonth.format(first)} – ${dayMonth.format(last)}`;
  const out = [`📅 ${homeroomName(data)} — неделя ${range}`];
  for (const d of days) {
    const end = lastEnd(d);
    out.push(
      '',
      `${cap(weekdayLong.format(d.date))}, ${dayMonth.format(d.date)}${!d.off && end ? ` · до ${end}` : ''}`,
    );
    if (d.off) out.push(`Уроков нет: ${d.off.title || 'выходной'}`);
    else if (!d.lines.length) out.push('Уроков нет');
    else {
      if (d.short) out.push('⏱ Сокращённые уроки');
      out.push(...d.lines.map((l) => lineText(l, o)));
    }
  }
  return out.join('\n');
}

/** Ближайший день с уроками у класса после `from` (на 3 недели вперёд). */
export function nextClassDay(data: AppData, from: Date): Date | null {
  for (let i = 1; i <= 21; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (d.getDay() >= 1 && d.getDay() <= 5 && classDay(data, d).lines.length) return d;
  }
  return null;
}

/** Какую неделю предлагать: с понедельника по среду — текущую, с четверга — следующую. */
export function shareWeekStart(now: Date): Date {
  const wd = now.getDay(); // 0 — воскресенье
  const toMonday = wd === 0 ? 1 : wd >= 4 ? 8 - wd : 1 - wd;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + toMonday);
}
