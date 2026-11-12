/**
 * Что изменилось у учителя после нового расписания от завуча — для плашки в виджете и уведомления.
 *
 * Сравниваются уже готовые документы приложения (до и после обновления), день за днём на две недели
 * вперёд: так учитываются и замены по датам, и новое основное расписание, и каникулы.
 * Чужие изменения не попадают: в документе учителя только его уроки и его класс.
 */
import { classDay, homeroomName } from './classText';
import { dayOf, isoDate, type AppData, type Lesson } from './domain';
import type { Fetched } from './school/api';
import type { SchoolLink } from './school/link';
import type { Id } from './school/model';
import { applySchool } from './schoolMode';

export type ChangeKind = 'замена' | 'кабинет' | 'отмена' | 'новый урок';
export type TeacherChange = { date: string; lessonNumber: number; kind: ChangeKind; text: string };
export type SchoolChanges = {
  /** Когда обнаружены (ISO). */
  at: string;
  items: TeacherChange[];
  /** Даты, когда изменилось расписание своего класса (классному руководителю). */
  classDates: string[];
  /** Системное уведомление ещё не показано (пришло в тихие часы). */
  notifyPending?: boolean;
};

const AHEAD = 14;
const MAX_ITEMS = 40;
const SHORT_DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const month = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

/** «пт, 13 ноября» */
export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${SHORT_DAYS[date.getDay()]}, ${month.format(date)}`;
};

const where = (l: Lesson) =>
  [l.className, l.room && (/^\d/.test(l.room) ? `каб. ${l.room}` : l.room)]
    .filter(Boolean)
    .join(', ');

function describe(date: string, n: number, was?: Lesson, now?: Lesson): TeacherChange | null {
  const head = `${shortDate(date)}, ${n} урок`;
  if (!was && now)
    return {
      date,
      lessonNumber: n,
      kind: 'новый урок',
      text: `${head}: новый урок — ${where(now)}`,
    };
  if (was && !now)
    return {
      date,
      lessonNumber: n,
      kind: 'отмена',
      text: `${head}: урока нет (было ${was.className})`,
    };
  if (!was || !now) return null;
  if (was.className === now.className && was.subject === now.subject && was.room === now.room)
    return null;
  if (was.className === now.className && was.subject === now.subject)
    return {
      date,
      lessonNumber: n,
      kind: 'кабинет',
      text: `${head}, ${now.className}: кабинет ${now.room || '—'} вместо ${was.room || '—'}`,
    };
  return {
    date,
    lessonNumber: n,
    kind: 'замена',
    text: `${head}: ${where(now)} вместо ${was.className}`,
  };
}

/** Изменения в уроках самого учителя с `from` на две недели. */
export function teacherChanges(before: AppData, after: AppData, from: Date): TeacherChange[] {
  const out: TeacherChange[] = [];
  for (let i = 0; i < AHEAD; i++) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (date.getDay() < 1 || date.getDay() > 5) continue;
    const a = dayOf(before, date).lessons;
    const b = dayOf(after, date).lessons;
    const nums = [...new Set([...a, ...b].map((l) => l.lessonNumber))].sort((x, y) => x - y);
    for (const n of nums) {
      const c = describe(
        isoDate(date),
        n,
        a.find((l) => l.lessonNumber === n),
        b.find((l) => l.lessonNumber === n),
      );
      if (c) out.push(c);
    }
  }
  return out;
}

/** Даты, когда изменилось расписание своего класса (только если класс тот же). */
export function classChangeDates(before: AppData, after: AppData, from: Date): string[] {
  const name = homeroomName(after);
  if (!name || name !== homeroomName(before)) return [];
  const key = (d: AppData, date: Date) =>
    JSON.stringify(
      classDay(d, date).lines.map((l) => [l.lessonNumber, l.subject, l.room, l.teacher]),
    );
  const out: string[] = [];
  for (let i = 0; i < AHEAD; i++) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (date.getDay() < 1 || date.getDay() > 5) continue;
    if (key(before, date) !== key(after, date)) out.push(isoDate(date));
  }
  return out;
}

/** Тихие часы 21:00–6:30: системное уведомление ждёт утра, плашка в приложении — сразу. */
export function quietHours(now: Date): boolean {
  const m = now.getHours() * 60 + now.getMinutes();
  return m >= 21 * 60 || m < 6 * 60 + 30;
}

/**
 * Обновить расписание от школы и запомнить, что изменилось у учителя.
 * Первое подключение и смена учителя изменениями не считаются — сравнивать не с чем.
 * Непросмотренные изменения копятся, пока учитель не нажмёт «Понятно».
 */
export function applyWithChanges(
  latest: AppData,
  fetched: Fetched,
  link: SchoolLink,
  teacherId: Id,
  now = new Date(),
): { data: AppData; fresh: SchoolChanges | null } {
  const next = applySchool(latest, fetched, link, teacherId, now);
  const prev = latest.school;
  if (!prev || prev.teacherId !== teacherId || prev.version === fetched.version) {
    if (prev?.changes && prev.teacherId === teacherId)
      next.school = { ...next.school!, changes: prev.changes };
    return { data: next, fresh: null };
  }
  const items = teacherChanges(latest, next, now);
  const classDates = classChangeDates(latest, next, now);
  const old = prev.changes;
  if (!items.length && !classDates.length) {
    if (old) next.school = { ...next.school!, changes: old };
    return { data: next, fresh: null };
  }
  const fresh: SchoolChanges = {
    at: now.toISOString(),
    items,
    classDates,
    notifyPending: quietHours(now),
  };
  const merged: SchoolChanges = {
    at: fresh.at,
    items: [
      ...(old?.items ?? []).filter(
        (x) => !items.some((y) => y.date === x.date && y.lessonNumber === x.lessonNumber),
      ),
      ...items,
    ]
      .sort((a, b) => a.date.localeCompare(b.date) || a.lessonNumber - b.lessonNumber)
      .slice(-MAX_ITEMS),
    classDates: [...new Set([...(old?.classDates ?? []), ...classDates])].sort(),
    notifyPending: fresh.notifyPending || old?.notifyPending,
  };
  next.school = { ...next.school!, changes: merged };
  return { data: next, fresh };
}

/** Текст системного уведомления: заголовок и до 4 строк. */
export function notificationText(
  ch: Pick<SchoolChanges, 'items' | 'classDates'>,
  className: string,
) {
  const lines = ch.items.slice(0, 4).map((x) => x.text);
  if (ch.items.length > 4) lines.push(`и ещё ${ch.items.length - 4}`);
  if (ch.classDates.length && className)
    lines.push(
      `У ${className} изменилось расписание: ${ch.classDates.slice(0, 3).map(shortDate).join('; ')}`,
    );
  const title = ch.items.length
    ? 'Завуч изменил ваше расписание'
    : `Изменилось расписание ${className}`;
  return { title, text: lines.join('\n') };
}
