/** Таблицы на день: учителя × уроки и классы × уроки. Только данные — без вёрстки. */
import {
  classSortKey,
  compareClasses,
  lookup,
  type Id,
  type Schedule,
  type SchoolClass,
  type Teacher,
} from './model';

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Номера уроков для колонок: от первого до последнего урока недели, без пропусков. */
export function lessonColumns(s: Schedule): number[] {
  const nums = s.entries.map((e) => e.lesson);
  if (!nums.length) return s.bells.map((b) => b.lesson);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const inBells = s.bells.map((b) => b.lesson).filter((n) => n >= min && n <= max);
  const all = new Set([...inBells, ...nums]);
  for (let n = min; n <= max; n++) all.add(n);
  return [...all].sort((x, y) => x - y);
}

export type TeacherCell = { classes: string; rooms: string; subjects: string };
export type TeacherRow = { teacher: Teacher; subject: string; cells: Map<number, TeacherCell> };

/** Главный предмет учителя — тот, которого у него больше всего за неделю. */
function mainSubjects(s: Schedule): Map<Id, string> {
  const L = lookup(s);
  const counts = new Map<Id, Map<string, number>>();
  for (const e of s.entries) {
    const subj = L.subject(e.subject)?.short ?? '';
    for (const t of e.teachers) {
      const m = counts.get(t) ?? new Map<string, number>();
      m.set(subj, (m.get(subj) ?? 0) + 1);
      counts.set(t, m);
    }
  }
  const res = new Map<Id, string>();
  for (const [t, m] of counts) res.set(t, [...m].sort((x, y) => y[1] - x[1])[0][0]);
  return res;
}

/** Все учителя, у которых есть уроки на неделе; клетки — на выбранный день. */
export function teacherRows(s: Schedule, day: number): TeacherRow[] {
  const L = lookup(s);
  const main = mainSubjects(s);
  const raw = new Map<
    Id,
    Map<number, { classes: string[]; rooms: string[]; subjects: string[] }>
  >();
  for (const e of s.entries) {
    if (e.day !== day) continue;
    for (const t of e.teachers) {
      const row = raw.get(t) ?? new Map();
      const cell = row.get(e.lesson) ?? { classes: [], rooms: [], subjects: [] };
      cell.classes.push(...e.classes.map((c) => L.cls(c)?.name ?? c));
      cell.rooms.push(...e.rooms.map((r) => L.room(r)?.short ?? r));
      cell.subjects.push(L.subject(e.subject)?.short ?? '');
      row.set(e.lesson, cell);
      raw.set(t, row);
    }
  }
  return s.teachers
    .filter((t) => main.has(t.id))
    .map((teacher) => {
      const cells = new Map<number, TeacherCell>();
      for (const [n, c] of raw.get(teacher.id) ?? []) {
        cells.set(n, {
          classes: uniq(c.classes).join(', '),
          rooms: uniq(c.rooms).join(', '),
          subjects: uniq(c.subjects).join(', '),
        });
      }
      return { teacher, subject: teacher.tag ?? main.get(teacher.id) ?? '', cells };
    })
    .sort(
      (x, y) =>
        x.subject.localeCompare(y.subject, 'ru') ||
        x.teacher.name.localeCompare(y.teacher.name, 'ru'),
    );
}

/**
 * Учитель начальных классов:
 *  - у завуча приставка «нач» в кратком имени («нач Нефедова»), или
 *  - классный руководитель 1–4 класса, или
 *  - все его уроки — в 1–4 классах, и приставки предмета у него нет.
 * Предметники, которые ведут уроки и в начальной школе (физкультура, музыка), сюда не попадают.
 */
export function primaryTeachers(s: Schedule): Set<Id> {
  const L = lookup(s);
  const grade = (c: Id) => {
    const cls = L.cls(c);
    return cls ? classSortKey(cls.name, cls.grade)[0] : 99;
  };
  const res = new Set<Id>();
  for (const c of s.classes) if (c.teacher && grade(c.id) <= 4) res.add(c.teacher);
  const grades = new Map<Id, number[]>();
  for (const e of s.entries)
    for (const t of e.teachers) grades.set(t, [...(grades.get(t) ?? []), ...e.classes.map(grade)]);
  for (const t of s.teachers) {
    if (t.tag && /^нач/i.test(t.tag)) res.add(t.id);
    else if (!t.tag && (grades.get(t.id) ?? []).length && grades.get(t.id)!.every((g) => g <= 4))
      res.add(t.id);
  }
  return res;
}

export type TeacherScope = 'all' | 'main' | 'primary';

export function teacherRowsIn(s: Schedule, day: number, scope: TeacherScope): TeacherRow[] {
  const rows = teacherRows(s, day);
  if (scope === 'all') return rows;
  const prim = primaryTeachers(s);
  return rows.filter((r) => (scope === 'primary') === prim.has(r.teacher.id));
}

export type ClassItem = {
  subject: string;
  short: string;
  group: string | null;
  teachers: string;
  rooms: string;
};
export type ClassRow = { cls: SchoolClass; cells: Map<number, ClassItem[]> };

export function classItemsAt(s: Schedule, classId: Id, day: number): Map<number, ClassItem[]> {
  const L = lookup(s);
  const cells = new Map<number, ClassItem[]>();
  for (const e of s.entries) {
    if (e.day !== day || !e.classes.includes(classId)) continue;
    const subj = L.subject(e.subject);
    const list = cells.get(e.lesson) ?? [];
    list.push({
      subject: subj?.name ?? '—',
      short: subj?.short ?? '—',
      group: e.group,
      teachers: e.teachers.map((t) => L.teacher(t)?.name ?? t).join(', '),
      rooms: uniq(e.rooms.map((r) => L.room(r)?.short ?? r)).join(', '),
    });
    cells.set(e.lesson, list);
  }
  for (const list of cells.values())
    list.sort((x, y) => (x.group ?? '').localeCompare(y.group ?? '', 'ru'));
  return cells;
}

export function classRows(s: Schedule, day: number): ClassRow[] {
  return [...s.classes]
    .sort(compareClasses)
    .map((cls) => ({ cls, cells: classItemsAt(s, cls.id, day) }));
}

export function sortedClasses(s: Schedule): SchoolClass[] {
  const used = new Set(s.entries.flatMap((e) => e.classes));
  return [...s.classes].filter((c) => used.has(c.id)).sort(compareClasses);
}
