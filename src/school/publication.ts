/**
 * Публикация расписания школы `tc-school/2` — то, что «Бланки» завуча отправляют учителям.
 *
 * Два слоя:
 *  - основы (`bases`) — основное расписание «действует с …». Хранится текущая и, если завуч заранее
 *    отправил новую с будущей даты, следующая: до этой даты учителя видят прежнюю;
 *  - замены (`overrides`) — расписание одного конкретного дня. Замена на 13 ноября не попадает
 *    в следующие пятницы.
 *
 * Плюс классное руководство, назначенное завучем вручную (если в aSc не заполнено или для пилота).
 * Модуль без React и сети: одинаково работает в «Бланках» и в Teacher Companion.
 */
import { addDays, weekdayOf } from './dates';
import {
  type Entry,
  type Id,
  type Schedule,
  type SchoolClass,
  type Subject,
  type Teacher,
  type Room,
} from './model';

export const PUB_FORMAT = 'tc-school/2' as const;

export type Base = { validFrom: string; schedule: Schedule };

/** Справочники, которых нет в основе (например, новый учитель на замене). */
export type Extra = {
  teachers?: Teacher[];
  subjects?: Subject[];
  rooms?: Room[];
  classes?: SchoolClass[];
};

/** Расписание одного дня `date` целиком (все уроки этого дня), а не только изменённые клетки. */
export type Override = { date: string; entries: Entry[]; extra?: Extra };

export type Publication = {
  format: typeof PUB_FORMAT;
  school: { id: string; name: string };
  /** Когда «Бланки» собрали публикацию. Номер версии ведёт сервер. */
  builtAt: string;
  bases: Base[];
  overrides: Override[];
  /** Классное руководство, назначенное в «Бланках»: класс → учитель. Главнее, чем в aSc. */
  homerooms: Record<Id, Id>;
};

/** Замены старше этого числа дней выбрасываем — учителям они уже не нужны. */
const KEEP_PAST_DAYS = 7;

const sameEntries = (a: Entry[], b: Entry[]) => {
  const key = (e: Entry) =>
    JSON.stringify([
      e.day,
      e.lesson,
      e.classes,
      e.group,
      e.subject,
      e.teachers,
      e.rooms,
      e.weeks ?? null,
      e.terms ?? null,
    ]);
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Основа, которая действует в дату `date`: последняя с validFrom ≤ date (или самая ранняя, если все позже). */
export function baseFor(pub: Pick<Publication, 'bases'>, date: string): Base | undefined {
  const sorted = [...pub.bases].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  return [...sorted].reverse().find((b) => b.validFrom <= date) ?? sorted[0];
}

function missing<T extends { id: Id }>(have: T[], want: T[], used: Set<Id>): T[] {
  const ids = new Set(have.map((x) => x.id));
  return want.filter((x) => used.has(x.id) && !ids.has(x.id));
}

/** Справочники из `from`, которые используются в `entries`, но которых нет в `base`. */
function extraFor(base: Schedule, from: Schedule, entries: Entry[]): Extra | undefined {
  const t = new Set(entries.flatMap((e) => e.teachers));
  const s = new Set(entries.map((e) => e.subject).filter((x): x is Id => !!x));
  const r = new Set(entries.flatMap((e) => e.rooms));
  const c = new Set(entries.flatMap((e) => e.classes));
  const extra: Extra = {
    teachers: missing(base.teachers, from.teachers, t),
    subjects: missing(base.subjects, from.subjects, s),
    rooms: missing(base.rooms, from.rooms, r),
    classes: missing(base.classes, from.classes, c),
  };
  const filled = Object.fromEntries(Object.entries(extra).filter(([, v]) => v.length));
  return Object.keys(filled).length ? filled : undefined;
}

/**
 * Расписание школы на конкретную дату: основа этой даты, а день недели `date` — из замены, если она есть.
 * Это и показывает Teacher Companion на «сегодня» и «завтра».
 */
export function scheduleForDate(pub: Publication, date: string): Schedule | undefined {
  const base = baseFor(pub, date);
  if (!base) return undefined;
  const o = pub.overrides.find((x) => x.date === date);
  const s = withHomerooms(base.schedule, pub.homerooms);
  if (!o) return s;
  const day = weekdayOf(date);
  const merge = <T extends { id: Id }>(a: T[], b: T[] = []) => [
    ...a,
    ...b.filter((x) => !a.some((y) => y.id === x.id)),
  ];
  return {
    ...s,
    teachers: merge(s.teachers, o.extra?.teachers),
    subjects: merge(s.subjects, o.extra?.subjects),
    rooms: merge(s.rooms, o.extra?.rooms),
    classes: merge(s.classes, o.extra?.classes),
    entries: [
      ...s.entries.filter((e) => e.day !== day),
      ...o.entries.map((e) => ({ ...e, day })),
    ].sort((a, b) => a.day - b.day || a.lesson - b.lesson),
  };
}

/** Классное руководство из «Бланков» поверх aSc. */
export function withHomerooms(s: Schedule, homerooms: Record<Id, Id>): Schedule {
  if (!Object.keys(homerooms).length) return s;
  return {
    ...s,
    classes: s.classes.map((c) => (homerooms[c.id] ? { ...c, teacher: homerooms[c.id] } : c)),
  };
}

/** Классы, где учитель — классный руководитель (по aSc или назначен завучем). */
export function homeroomClasses(pub: Publication, teacherId: Id, date: string): SchoolClass[] {
  const s = scheduleForDate(pub, date);
  return s ? s.classes.filter((c) => c.teacher === teacherId) : [];
}

/** Лёгкая копия расписания для отправки: без служебных заметок разбора. */
function slim(s: Schedule): Schedule {
  const { notes: _notes, ...rest } = s;
  void _notes;
  return { ...rest, warnings: [] };
}

export type Change =
  /** Новое основное расписание, действует с `validFrom`. */
  | { kind: 'base'; validFrom: string; schedule: Schedule }
  /** Замены: день `date` берётся из выгрузки `schedule`. */
  | { kind: 'override'; date: string; schedule: Schedule };

export type BuildOptions = {
  school: { id: string; name: string };
  homerooms?: Record<Id, Id>;
  today: string;
  now?: Date;
};

/**
 * Следующая публикация из предыдущей и изменения завуча.
 * - новое основное: прежняя основа остаётся только для дат до `validFrom`; замены с этой даты и позже
 *   выбрасываются — они считались от старой основы;
 * - замена: день `date` из выгрузки; если он совпал с основой — замена снимается;
 * - замены старше недели удаляются.
 */
export function nextPublication(
  prev: Publication | null,
  change: Change,
  opt: BuildOptions,
): Publication {
  let bases = prev?.bases ?? [];
  let overrides = prev?.overrides ?? [];

  if (change.kind === 'base') {
    const older = bases
      .filter((b) => b.validFrom < change.validFrom)
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    // Нужна только та прежняя основа, что действует до новой — и только если новая ещё не началась.
    const keep = change.validFrom > opt.today && older.length ? [older[older.length - 1]] : [];
    bases = [...keep, { validFrom: change.validFrom, schedule: slim(change.schedule) }];
    overrides = overrides.filter((o) => o.date < change.validFrom);
  } else {
    const base = baseFor({ bases }, change.date);
    if (!base) throw new Error('Сначала отправьте основное расписание, потом замены.');
    const day = weekdayOf(change.date);
    const entries = change.schedule.entries.filter((e) => e.day === day);
    overrides = overrides.filter((o) => o.date !== change.date);
    if (
      !sameEntries(
        entries,
        base.schedule.entries.filter((e) => e.day === day),
      )
    ) {
      const extra = extraFor(base.schedule, change.schedule, entries);
      overrides = [...overrides, { date: change.date, entries, ...(extra ? { extra } : {}) }];
    }
  }

  const oldest = addDays(opt.today, -KEEP_PAST_DAYS);
  return {
    format: PUB_FORMAT,
    school: opt.school,
    builtAt: (opt.now ?? new Date()).toISOString(),
    bases,
    overrides: overrides
      .filter((o) => o.date >= oldest)
      .sort((a, b) => a.date.localeCompare(b.date)),
    homerooms: opt.homerooms ?? prev?.homerooms ?? {},
  };
}

/** Проверка, что расшифрованный файл — действительно публикация, которую мы понимаем. */
export function assertPublication(x: unknown): asserts x is Publication {
  const p = x as Publication;
  if (!p || p.format !== PUB_FORMAT)
    throw new Error(
      'Это не расписание школы или слишком новая версия формата — обновите приложение.',
    );
  if (!Array.isArray(p.bases) || !p.bases.length)
    throw new Error('В расписании школы нет основного расписания.');
}
