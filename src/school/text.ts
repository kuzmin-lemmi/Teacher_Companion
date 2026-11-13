/** Расписание класса на день — строки и простой текст для чата (Max, Telegram, WhatsApp). */
import { lookup, plural, type Id, type Schedule } from './model';
import { classItemsAt } from './views';

export type ChatLine = {
  lesson: number;
  start: string;
  end: string;
  title: string;
  rooms: string;
  teachers: string;
};

export function classDayLines(s: Schedule, classId: Id, day: number): ChatLine[] {
  const L = lookup(s);
  const cells = classItemsAt(s, classId, day);
  return [...cells.keys()]
    .sort((x, y) => x - y)
    .map((n) => {
      const items = cells.get(n)!;
      const bySubject = new Map<string, typeof items>();
      for (const it of items) bySubject.set(it.subject, [...(bySubject.get(it.subject) ?? []), it]);
      const parts = [...bySubject].map(([subject, list]) => {
        if (list.length > 1)
          return `${subject} (${list.length} ${plural(list.length, 'группа', 'группы', 'групп')})`;
        const g = list[0].group;
        return g && bySubject.size === 1 ? `${subject} (${g})` : subject;
      });
      const bell = L.bell(n);
      return {
        lesson: n,
        start: bell?.start ?? '',
        end: bell?.end ?? '',
        title: parts.join(' / '),
        rooms: [...new Set(items.map((i) => i.rooms).filter(Boolean))].join(', '),
        teachers: [...new Set(items.map((i) => i.teachers).filter(Boolean))].join(', '),
      };
    });
}

export type TextOptions = { rooms: boolean; teachers: boolean };

/** «12, 15» → «каб. 12, 15»; «Спортзал» остаётся как есть. */
export function roomLabel(rooms: string): string {
  return /^\d/.test(rooms) ? `каб. ${rooms}` : rooms;
}

/** Формат согласован в требованиях школьной версии: простой текст, эмодзи, без Markdown. */
export function classDayText(
  s: Schedule,
  classId: Id,
  day: number,
  dateLabel: string,
  opts: TextOptions,
): string {
  const cls = lookup(s).cls(classId)?.name ?? classId;
  const lines = classDayLines(s, classId, day);
  const out = [`📅 ${cls} — ${dateLabel}`, ''];
  if (!lines.length) {
    out.push('Уроков нет');
    return out.join('\n');
  }
  for (const l of lines) {
    const t = l.start && l.end ? ` ${l.start}–${l.end}` : '';
    const extra = [
      opts.rooms && l.rooms ? roomLabel(l.rooms) : '',
      opts.teachers && l.teachers ? l.teachers : '',
    ]
      .filter(Boolean)
      .join(', ');
    out.push(`${l.lesson}.${t} ${l.title}${extra ? `, ${extra}` : ''}`);
  }
  const last = lines[lines.length - 1];
  if (last.end) out.push('', `🔔 Уроки заканчиваются в ${last.end}`);
  return out.join('\n');
}
