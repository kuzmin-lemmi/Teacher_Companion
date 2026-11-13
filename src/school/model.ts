/**
 * Общий формат расписания школы `tc-school/1`.
 *
 * Сюда сводится выгрузка любой программы завуча (сейчас — aSc, раньше — «Ректор»).
 * Бланки для печати, картинки для чатов, а позже Teacher Companion читают только этот формат
 * и ничего не знают о программе, из которой он получен.
 *
 * Модуль без зависимостей от React и браузера — его можно перенести в Teacher Companion как есть.
 */
export const FORMAT = 'tc-school/1' as const;

export type Id = string;

/** День недели: `n` — 1 = понедельник … 6 = суббота. */
export type Day = { n: number; name: string; short: string };

/** Звонок: `lesson` — номер урока, как в программе завуча (бывает и нулевой). */
export type Bell = { lesson: number; label: string; start: string; end: string };

export type Subject = { id: Id; name: string; short: string };
/**
 * `name` — «Фамилия И. О.», `short` — краткое имя из программы завуча,
 * `tag` — приставка предмета из краткого имени («мат», «рус»), если завуч её ставит.
 */
export type Teacher = { id: Id; name: string; short: string; tag?: string };
export type Room = { id: Id; name: string; short: string };
/** `teacher` — классный руководитель, если он указан в программе завуча. */
export type SchoolClass = { id: Id; name: string; grade: number | null; teacher: Id | null };

/**
 * Один урок в одной клетке расписания.
 * Несколько классов — объединённый урок; `group` — название группы, если урок не у всего класса.
 * `weeks` — маска недель («10» — только первая), `null` — каждую неделю.
 */
export type Entry = {
  day: number;
  lesson: number;
  classes: Id[];
  group: string | null;
  subject: Id | null;
  teachers: Id[];
  rooms: Id[];
  weeks: string | null;
  /** Маска полугодий/четвертей («10» — только первое), если урок идёт не весь год. */
  terms?: string | null;
  /** Деление на группы (aSc divisiontag): «1 группа / 2 группа» — одно деление, «Мальчики / Девочки» — другое. */
  division?: string | null;
};

/** Идут ли два урока хоть в одну общую неделю и четверть. */
export function overlapsInTime(
  a: Pick<Entry, 'weeks' | 'terms'>,
  b: Pick<Entry, 'weeks' | 'terms'>,
): boolean {
  const meet = (x?: string | null, y?: string | null) =>
    !x || !y || [...x].some((c, i) => c === '1' && y[i] === '1');
  return meet(a.weeks, b.weeks) && meet(a.terms, b.terms);
}

export type Schedule = {
  format: typeof FORMAT;
  source: { app: string; file: string };
  /** Когда файл разобран (ISO). */
  importedAt: string;
  days: Day[];
  bells: Bell[];
  subjects: Subject[];
  teachers: Teacher[];
  rooms: Room[];
  classes: SchoolClass[];
  entries: Entry[];
  /** Что показалось подозрительным при разборе — короткие строки. Подробности — `notes` и checks.ts. */
  warnings: string[];
  /** Подробности о том, что не удалось разложить по клеткам (для объяснения завучу). */
  notes?: ParseNotes;
};

/** Урок из нагрузки программы завуча, о котором надо рассказать подробно. */
export type LessonNote = {
  classes: Id[];
  subject: Id | null;
  teachers: Id[];
  day?: number;
  lesson?: number;
  perWeek?: number;
  placed?: number;
};
export type ParseNotes = {
  /** Карточек в файле и сколько уроков программа достроила сама (вторые половины пар). */
  cards: number;
  synthesized: number;
  /** Поставлено не столько уроков, сколько часов в нагрузке. */
  partial: LessonNote[];
  /** Сдвоенный урок стоит последним — вторая половина за последним звонком. */
  overflow: LessonNote[];
  /** Урок есть в нагрузке, но не поставлен ни в одну клетку. */
  unplaced: LessonNote[];
  /** Карточки без урока в нагрузке. */
  orphanCards: number;
};

export type Lookup = {
  subject: (id: Id | null) => Subject | undefined;
  teacher: (id: Id) => Teacher | undefined;
  room: (id: Id) => Room | undefined;
  cls: (id: Id) => SchoolClass | undefined;
  bell: (lesson: number) => Bell | undefined;
};

const cache = new WeakMap<Schedule, Lookup>();

export function lookup(s: Schedule): Lookup {
  const hit = cache.get(s);
  if (hit) return hit;
  const by = <T extends { id: Id }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const subjects = by(s.subjects);
  const teachers = by(s.teachers);
  const rooms = by(s.rooms);
  const classes = by(s.classes);
  const bells = new Map(s.bells.map((b) => [b.lesson, b]));
  const l: Lookup = {
    subject: (id) => (id == null ? undefined : subjects.get(id)),
    teacher: (id) => teachers.get(id),
    room: (id) => rooms.get(id),
    cls: (id) => classes.get(id),
    bell: (n) => bells.get(n),
  };
  cache.set(s, l);
  return l;
}

/** «10б» → [10, "б"]; без номера — в конец. */
export function classSortKey(name: string, grade: number | null = null): [number, string] {
  const m = /^\s*(\d+)\s*(.*)$/.exec(name);
  const g = grade ?? (m ? Number(m[1]) : 99);
  return [g, (m ? m[2] : name).toLowerCase()];
}

export function compareClasses(a: SchoolClass, b: SchoolClass): number {
  const [ga, la] = classSortKey(a.name, a.grade);
  const [gb, lb] = classSortKey(b.name, b.grade);
  return ga - gb || la.localeCompare(lb, 'ru');
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
