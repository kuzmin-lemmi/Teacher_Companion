/**
 * Школьный режим: расписание приходит от завуча (aSc → «Бланки» → сервер школы).
 *
 * Школьные уроки превращаются в обычные уроки приложения (`AppData.lessons`, `bells`, `homeroom`),
 * поэтому виджет, шторка, напоминания и виджеты Android работают без изменений. Замены на конкретные
 * даты — в `AppData.schoolDays`: `dayOf` берёт день оттуда, если он там есть.
 *
 * Личное расписание учителя при подключении откладывается в `school.personal` и возвращается при отключении.
 */
import {
  isoDate,
  validate,
  type AppData,
  type ClassLesson,
  type Homeroom,
  type Lesson,
  type LessonTime,
} from './domain';
import { schoolApi, type Fetched } from './school/api';
import type { SchoolLink } from './school/link';
import { compareClasses, lookup, type Id, type Schedule } from './school/model';
import { baseFor, scheduleForDate, withHomerooms, type Publication } from './school/publication';
import { classDayLines } from './school/text';

export type SchoolState = SchoolLink & {
  schoolName: string;
  teacherId: string;
  teacherName: string;
  /** Номер версии на сервере и когда завуч её отправил. */
  version: number;
  publishedAt: string;
  /** Дата, на которую разложены уроки (`schoolDays` считаются от неё на 4 недели вперёд). */
  appliedOn: string;
  /** Классное руководство из школы, если есть. */
  homeroomClass?: string;
  /** Личное расписание до подключения — вернётся при отключении. */
  personal: { lessons: Lesson[]; bells: LessonTime[]; homeroom?: Homeroom };
};

/** На сколько дней вперёд раскладываем замены и будущее основное расписание. */
const AHEAD_DAYS = 28;

const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
};
const weekdayOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
};
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

/** Учителя школы для экрана «Кто вы?»: с числом уроков, чтобы не перепутать однофамильцев. */
export function teacherChoices(pub: Publication, date: string) {
  const s = baseFor(pub, date)?.schedule;
  if (!s) return [];
  const count = new Map<Id, number>();
  for (const e of s.entries) for (const t of e.teachers) count.set(t, (count.get(t) ?? 0) + 1);
  return s.teachers
    .filter((t) => count.has(t.id))
    .map((t) => ({ id: t.id, name: t.name, tag: t.tag ?? '', lessons: count.get(t.id)! }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/** Уроки учителя (на день недели `weekday` или на всю неделю). Два класса в одной клетке — одним уроком. */
export function teacherLessons(
  s: Schedule,
  teacherId: Id,
  idPrefix = 'school',
  weekday?: number,
): Lesson[] {
  const L = lookup(s);
  const cells = new Map<
    string,
    { day: number; n: number; classes: string[]; subjects: string[]; rooms: string[] }
  >();
  for (const e of s.entries) {
    if (!e.teachers.includes(teacherId)) continue;
    if (weekday != null && e.day !== weekday) continue;
    // В приложении — пн–пт и уроки 1–20 (так проверяет validate).
    if (e.day < 1 || e.day > 5 || e.lesson < 1 || e.lesson > 20) continue;
    const k = `${e.day}-${e.lesson}`;
    const c = cells.get(k) ?? { day: e.day, n: e.lesson, classes: [], subjects: [], rooms: [] };
    c.classes.push(...e.classes.map((id) => L.cls(id)?.name ?? ''));
    c.subjects.push(L.subject(e.subject)?.name ?? '');
    c.rooms.push(...e.rooms.map((id) => L.room(id)?.short ?? ''));
    cells.set(k, c);
  }
  return [...cells.values()]
    .sort((a, b) => a.day - b.day || a.n - b.n)
    .map((c) => ({
      id: `${idPrefix}-${c.day}-${c.n}`,
      weekday: c.day,
      lessonNumber: c.n,
      className: uniq(c.classes).join(', '),
      subject: uniq(c.subjects).join(' / '),
      room: uniq(c.rooms).join(', '),
    }));
}

/** Звонки из aSc — только если они полные и подходят приложению. */
export function schoolBells(s: Schedule): LessonTime[] {
  return s.bells
    .filter((b) => b.start && b.end && b.lesson >= 1 && b.lesson <= 20)
    .map((b) => ({ lessonNumber: b.lesson, start: b.start, end: b.end }));
}

/** Неделя класса для «Моего класса»: предмет, кабинет, учитель; группы — одной строкой. */
export function classLessons(s: Schedule, classId: Id): ClassLesson[] {
  const out: ClassLesson[] = [];
  for (let day = 1; day <= 5; day++)
    for (const l of classDayLines(s, classId, day))
      if (l.lesson >= 1 && l.lesson <= 20)
        out.push({
          id: `school-class-${day}-${l.lesson}`,
          weekday: day,
          lessonNumber: l.lesson,
          subject: l.title,
          room: l.rooms,
          teacher: l.teachers,
        });
  return out;
}

const sameLessons = (a: Lesson[], b: Lesson[]) => {
  const key = (l: Lesson) => `${l.lessonNumber}|${l.className}|${l.subject}|${l.room}`;
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export class SchoolApplyError extends Error {}

/**
 * Документ приложения с расписанием школы для учителя `teacherId` на дату `now`.
 * Личное расписание (если школа подключается впервые) откладывается в `school.personal`.
 */
export function applySchool(
  data: AppData,
  fetched: Fetched,
  link: SchoolLink,
  teacherId: Id,
  now = new Date(),
): AppData {
  const pub = fetched.publication;
  const today = isoDate(now);
  const base = baseFor(pub, today);
  if (!base) throw new SchoolApplyError('В расписании школы нет основного расписания.');
  const weekly = withHomerooms(base.schedule, pub.homerooms);
  const teacher = weekly.teachers.find((t) => t.id === teacherId);
  if (!teacher)
    throw new SchoolApplyError('Вас нет в расписании школы. Выберите себя из списка заново.');

  const lessons = teacherLessons(weekly, teacherId);
  const schoolDays: Record<string, Lesson[]> = {};
  for (let i = 0; i < AHEAD_DAYS; i++) {
    const date = addDays(today, i);
    const wd = weekdayOf(date);
    if (wd < 1 || wd > 5) continue;
    const s = scheduleForDate(pub, date);
    if (!s) continue;
    const day = teacherLessons(s, teacherId, `school-${date}`, wd);
    if (
      !sameLessons(
        day,
        lessons.filter((l) => l.weekday === wd),
      )
    )
      schoolDays[date] = day;
  }

  const homeClass = weekly.classes.filter((c) => c.teacher === teacherId).sort(compareClasses)[0];
  const personal = data.school?.personal ?? {
    lessons: data.lessons,
    bells: data.bells,
    homeroom: data.homeroom,
  };
  const bells = schoolBells(weekly);
  const school: SchoolState = {
    server: link.server,
    school: link.school,
    key: link.key,
    schoolName: pub.school.name,
    teacherId,
    teacherName: teacher.name,
    version: fetched.version,
    publishedAt: fetched.publishedAt,
    appliedOn: today,
    ...(homeClass ? { homeroomClass: homeClass.name } : {}),
    personal,
  };
  const next: AppData = {
    ...data,
    lessons,
    bells: bells.length ? bells : data.bells,
    schoolDays,
    homeroom: homeClass
      ? { enabled: true, className: homeClass.name, lessons: classLessons(weekly, homeClass.id) }
      : personal.homeroom,
    school,
  };
  // Звонки aSc иногда не подходят под правила приложения (пересекаются) — тогда оставляем свои.
  if (validate(next).length && bells.length) next.bells = data.bells;
  const errors = validate(next);
  if (errors.length) throw new SchoolApplyError(`Расписание школы не подошло: ${errors[0]}`);
  return next;
}

/** Отключиться от школы: вернуть личное расписание, забыть ключ школы. */
export function disconnectSchool(data: AppData): AppData {
  const { school, schoolDays: _days, ...rest } = data;
  void _days;
  if (!school) return data;
  return {
    ...rest,
    lessons: school.personal.lessons,
    bells: school.personal.bells,
    homeroom: school.personal.homeroom,
  };
}

export type SyncResult =
  | { kind: 'none' }
  | { kind: 'update'; fetched: Fetched; link: SchoolLink; teacherId: Id }
  | { kind: 'error'; message: string };

/**
 * Проверить, есть ли новое расписание. Сначала дешёвый `meta`; всё расписание скачивается,
 * только если версия новая или наступил новый день (замены и будущее основное раскладываются по датам).
 */
export async function checkSchool(
  data: AppData,
  now = new Date(),
  api = schoolApi,
): Promise<SyncResult> {
  const st = data.school;
  if (!st) return { kind: 'none' };
  let link: SchoolLink = { server: st.server, school: st.school, key: st.key };
  try {
    const meta = await api.meta(link);
    if (meta.movedTo) link = { ...link, server: meta.movedTo };
    if (meta.version === st.version && st.appliedOn === isoDate(now) && !meta.movedTo)
      return { kind: 'none' };
    const fetched = await api.fetch(link);
    if (!fetched) return { kind: 'none' };
    let teacherId = st.teacherId;
    const choices = teacherChoices(fetched.publication, isoDate(now));
    if (!choices.some((t) => t.id === teacherId)) {
      // Завуч пересоздал учителя в aSc — находим по фамилии и инициалам, если такой один.
      const same = choices.filter((t) => t.name === st.teacherName);
      if (same.length !== 1)
        return {
          kind: 'error',
          message: 'Вас нет в новом расписании школы. Выберите себя заново.',
        };
      teacherId = same[0].id;
    }
    return { kind: 'update', fetched, link, teacherId };
  } catch (e) {
    return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** «13 ноя, 07:40» */
export const schoolStamp = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
