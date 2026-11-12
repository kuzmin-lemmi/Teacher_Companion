/**
 * Что изменилось на день по сравнению с основным расписанием — это и есть лист замен.
 * Сравниваем по названиям (класс, номер урока), а не по внутренним id aSc:
 * так сравнение работает и между разными файлами.
 */
import { classSortKey, lookup, type Schedule } from './model';
import { teacherRows } from './views';

export type ChangeKind = 'замена' | 'кабинет' | 'отмена' | 'новый урок';
export type Change = {
  className: string;
  lesson: number;
  kind: ChangeKind;
  before: string[];
  after: string[];
  teachers: string[];
};

type Item = { full: string; noRoom: string; teachers: string[] };

function slots(s: Schedule, day: number): Map<string, Item[]> {
  const L = lookup(s);
  const res = new Map<string, Item[]>();
  for (const e of s.entries) {
    if (e.day !== day) continue;
    const subj = L.subject(e.subject)?.name ?? '—';
    const teachers = e.teachers.map((t) => L.teacher(t)?.name ?? t);
    const rooms = e.rooms.map((r) => L.room(r)?.short ?? r).join(', ');
    const head = `${e.group ? `${e.group}: ` : ''}${subj}${teachers.length ? ` — ${teachers.join(', ')}` : ''}`;
    const item = { full: rooms ? `${head}, каб. ${rooms}` : head, noRoom: head, teachers };
    for (const c of e.classes) {
      const key = `${L.cls(c)?.name ?? c}|${e.lesson}`;
      res.set(key, [...(res.get(key) ?? []), item]);
    }
  }
  return res;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function diffDay(before: Schedule, after: Schedule, day: number): Change[] {
  const b = slots(before, day);
  const a = slots(after, day);
  const changes: Change[] = [];
  for (const key of new Set([...b.keys(), ...a.keys()])) {
    const was = b.get(key) ?? [];
    const now = a.get(key) ?? [];
    const wasFull = was.map((i) => i.full).sort();
    const nowFull = now.map((i) => i.full).sort();
    if (same(wasFull, nowFull)) continue;
    const [className, lesson] = key.split('|');
    const kind: ChangeKind = !was.length
      ? 'новый урок'
      : !now.length
        ? 'отмена'
        : same(was.map((i) => i.noRoom).sort(), now.map((i) => i.noRoom).sort())
          ? 'кабинет'
          : 'замена';
    changes.push({
      className,
      lesson: Number(lesson),
      kind,
      before: wasFull,
      after: nowFull,
      teachers: [...new Set([...was, ...now].flatMap((i) => i.teachers))].sort((x, y) =>
        x.localeCompare(y, 'ru'),
      ),
    });
  }
  return changes.sort((x, y) => {
    const [gx, lx] = classSortKey(x.className);
    const [gy, ly] = classSortKey(y.className);
    return gx - gy || lx.localeCompare(ly, 'ru') || x.lesson - y.lesson;
  });
}

/** Клетки «класс|урок», которые изменились, — для подсветки на бланках. */
export function changedClassSlots(changes: Change[]): Set<string> {
  return new Set(changes.map((c) => `${c.className}|${c.lesson}`));
}

/** Клетки «учитель|урок», которые изменились. */
export function changedTeacherCells(before: Schedule, after: Schedule, day: number): Set<string> {
  const text = (s: Schedule) => {
    const m = new Map<string, string>();
    for (const r of teacherRows(s, day))
      for (const [n, c] of r.cells)
        m.set(`${r.teacher.name}|${n}`, `${c.classes}|${c.rooms}|${c.subjects}`);
    return m;
  };
  const b = text(before);
  const a = text(after);
  const res = new Set<string>();
  for (const k of new Set([...b.keys(), ...a.keys()])) if (b.get(k) !== a.get(k)) res.add(k);
  return res;
}
