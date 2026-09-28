export const weekdays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
export type LessonTime = { lessonNumber: number; start: string; end: string };
export type Lesson = {
  id: string;
  weekday: number;
  lessonNumber: number;
  className: string;
  subject: string;
  room: string;
  customTime?: { start: string; end: string };
};
/** Каникулы или праздник: даты `YYYY-MM-DD` включительно, один день — `start === end`. */
export type DayOff = { id: string; title: string; start: string; end: string };
/** Заметка к уроку с этим номером в конкретную дату. */
export type LessonNote = { date: string; lessonNumber: number; text: string };
export const widgetCorners = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;
export type WidgetCorner = (typeof widgetCorners)[number];
export type Settings = {
  launchOnStartup: boolean;
  alwaysOnTop: boolean;
  locked: boolean;
  widgetSize: 'compact' | 'normal';
  widgetCorner: WidgetCorner;
  opacity: number;
  theme: 'system' | 'light' | 'dark';
  closeBehavior: 'tray' | 'exit';
  /** Раз в несколько часов спрашивать GitHub, есть ли новая версия. */
  checkUpdates: boolean;
};
export type AppData = {
  version: 1;
  lessons: Lesson[];
  bells: LessonTime[];
  /** Дни без уроков: каникулы и праздники. */
  holidays: DayOff[];
  /** Даты `YYYY-MM-DD`, в которые действуют сокращённые звонки. */
  shortDays: string[];
  shortBells: LessonTime[];
  notes: LessonNote[];
  settings: Settings;
  /** Устарело: мастера первого запуска больше нет. Поле остаётся, чтобы читались старые копии. */
  onboardingComplete?: boolean;
};
export const emptyData = (): AppData => ({
  version: 1,
  lessons: [],
  bells: [],
  holidays: [],
  shortDays: [],
  shortBells: [],
  notes: [],
  settings: {
    launchOnStartup: false,
    alwaysOnTop: false,
    locked: false,
    widgetSize: 'compact',
    widgetCorner: 'top-right',
    opacity: 100,
    theme: 'dark',
    closeBehavior: 'tray',
    checkUpdates: true,
  },
});
/**
 * Дополняет документ старой версии полями, которых в нём ещё не было.
 * Нужна и для резервных копий, и для черновиков, сохранённых прежними версиями.
 */
export function normalize(data: AppData): AppData {
  const s = data.settings;
  // Копии до версии 0.2 не содержат угла виджета.
  if (s && typeof s === 'object' && s.widgetCorner === undefined) s.widgetCorner = 'top-right';
  // Копии до версии 0.5 не содержат настройки обновлений.
  if (s && typeof s === 'object' && s.checkUpdates === undefined) s.checkUpdates = true;
  // Копии до версии 0.7 не содержат календаря и заметок.
  data.holidays ??= [];
  data.shortDays ??= [];
  data.shortBells ??= [];
  data.notes ??= [];
  return data;
}
/** То, что правит редактор расписания. Заметки и настройки меняются в других местах. */
export type Schedule = Pick<AppData, 'lessons' | 'bells' | 'holidays' | 'shortDays' | 'shortBells'>;
/** Документ `data` с расписанием из `schedule`: заметки и настройки остаются из `data`. */
export function withSchedule(data: AppData, schedule: Schedule): AppData {
  const { lessons, bells, holidays, shortDays, shortBells } = schedule;
  return { ...data, lessons, bells, holidays, shortDays, shortBells };
}
const pad = (n: number) => String(n).padStart(2, '0');
/** Дата `YYYY-MM-DD` по местному времени. */
export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d)) === value;
}
/** Сокращённый звонок на этот номер важнее индивидуального времени урока. */
export function timeOf(lesson: Lesson, bells: LessonTime[], short: LessonTime[] = []) {
  const n = lesson.lessonNumber;
  return (
    short.find((b) => b.lessonNumber === n) ??
    lesson.customTime ??
    bells.find((b) => b.lessonNumber === n)
  );
}
export function lessonsForDay(lessons: Lesson[], weekday: number) {
  return lessons
    .filter((l) => l.weekday === weekday)
    .sort((a, b) => a.lessonNumber - b.lessonNumber);
}
export type Calendar = Pick<
  AppData,
  'lessons' | 'bells' | 'holidays' | 'shortDays' | 'shortBells' | 'notes'
>;
export function dayOff(data: Pick<AppData, 'holidays'>, date: Date): DayOff | undefined {
  const key = isoDate(date);
  return data.holidays.find((h) => h.start <= key && key <= h.end);
}
/** Расписание конкретной даты: с учётом каникул, сокращённых звонков и заметок. */
export type Day = {
  date: Date;
  off?: DayOff;
  /** Сокращённый день — и для него заданы сокращённые звонки. */
  short: boolean;
  lessons: Lesson[];
  bell(lessonNumber: number): LessonTime | undefined;
  time(lesson: Lesson): { start: string; end: string } | undefined;
  note(lessonNumber: number): string;
};
export function dayOf(data: Calendar, date: Date): Day {
  const key = isoDate(date);
  const off = dayOff(data, date);
  const short = data.shortDays.includes(key) && data.shortBells.length > 0;
  const shortBells = short ? data.shortBells : [];
  return {
    date,
    off,
    short,
    lessons: off ? [] : lessonsForDay(data.lessons, date.getDay()),
    bell: (n) =>
      shortBells.find((b) => b.lessonNumber === n) ?? data.bells.find((b) => b.lessonNumber === n),
    time: (lesson) => timeOf(lesson, data.bells, shortBells),
    note: (n) => data.notes.find((x) => x.date === key && x.lessonNumber === n)?.text ?? '',
  };
}
/** Каникулы бывают долгими — летние почти три месяца, поэтому ищем на год вперёд. */
const SEARCH_DAYS = 366;
export function getNextSchoolDay(
  data: Pick<AppData, 'lessons' | 'holidays'>,
  today = new Date(),
): Date | null {
  if (!data.lessons.some((l) => l.weekday >= 1 && l.weekday <= 5)) return null;
  for (let offset = 1; offset <= SEARCH_DAYS; offset++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (
      date.getDay() >= 1 &&
      date.getDay() <= 5 &&
      data.lessons.some((l) => l.weekday === date.getDay()) &&
      !dayOff(data, date)
    )
      return date;
  }
  return null;
}
export type DayMode = 'today' | 'next';
/** Сегодня — пока не закончился последний урок с известным временем, затем следующий учебный день. */
export function autoDayMode(data: Calendar, now: Date): DayMode {
  const clock = now.toTimeString().slice(0, 5);
  const today = dayOf(data, now);
  const ends = today.lessons.map((l) => today.time(l)?.end).filter((end): end is string => !!end);
  return ends.some((end) => clock < end) ? 'today' : 'next';
}
/** За сколько минут до урока начинать отсчёт «через N мин» — иначе ночью висело бы «через 9 ч». */
export const COUNTDOWN_AHEAD = 60;
export type Countdown =
  | { kind: 'lesson'; lessonId: string; minutes: number; progress: number }
  | { kind: 'break'; lessonId: string; minutes: number };
export const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
export const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
/**
 * Идёт урок — сколько до звонка с него; перемена, окно или утро — сколько до ближайшего урока.
 * Минуты округляются вверх: за 30 секунд до звонка это «1 мин», а не «0».
 */
export function countdown(day: Pick<Day, 'lessons' | 'time'>, now: Date): Countdown | null {
  const at = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  for (const lesson of [...day.lessons].sort((a, b) => a.lessonNumber - b.lessonNumber)) {
    const time = day.time(lesson);
    if (!time) continue;
    const start = minutesOf(time.start);
    const end = minutesOf(time.end);
    if (at < start) {
      const minutes = Math.ceil(start - at);
      return minutes <= COUNTDOWN_AHEAD ? { kind: 'break', lessonId: lesson.id, minutes } : null;
    }
    if (at < end)
      return {
        kind: 'lesson',
        lessonId: lesson.id,
        minutes: Math.ceil(end - at),
        progress: (at - start) / (end - start),
      };
  }
  return null;
}
/**
 * Сокращённые звонки из обычных: первый урок начинается как обычно,
 * дальше уроки и перемены заданной длины для тех же номеров.
 */
export function shortenBells(bells: LessonTime[], lesson: number, rest: number): LessonTime[] {
  const ordered = [...bells]
    .filter((b) => /^\d\d:\d\d$/.test(b.start))
    .sort((a, b) => a.lessonNumber - b.lessonNumber);
  if (!ordered.length) return [];
  let start = minutesOf(ordered[0].start);
  const result: LessonTime[] = [];
  for (const b of ordered) {
    if (start + lesson >= 24 * 60) break;
    result.push({ lessonNumber: b.lessonNumber, start: hhmm(start), end: hhmm(start + lesson) });
    start += lesson + rest;
  }
  return result;
}
/** Звонки с нуля: первый урок в `first`, дальше уроки и перемены заданной длины. */
export function generateBells(first: string, count: number, lesson: number, rest: number) {
  const result: LessonTime[] = [];
  let start = minutesOf(first);
  for (let n = 1; n <= count && start + lesson < 24 * 60; n++) {
    result.push({ lessonNumber: n, start: hhmm(start), end: hhmm(start + lesson) });
    start += lesson + rest;
  }
  return result;
}
/**
 * Следующий звонок после последнего: номер за последним и та же длина урока и перемены,
 * что у предыдущих (по умолчанию 45 и 10 минут). Пустое время — если день уже закончился.
 */
export function nextBell(bells: LessonTime[]): LessonTime {
  const ordered = [...bells]
    .filter((b) => /^\d\d:\d\d$/.test(b.start) && /^\d\d:\d\d$/.test(b.end))
    .sort((a, b) => a.lessonNumber - b.lessonNumber);
  // При звонках 1, 2, 3, 5 новый — 6-й: 4-й со временем после 5-го сразу был бы ошибкой.
  let lessonNumber =
    Math.max(0, ...bells.map((b) => b.lessonNumber).filter((n) => Number.isInteger(n))) + 1;
  if (lessonNumber > 20) {
    // Дальше 20-го нельзя — первый свободный номер, время для него задают вручную.
    lessonNumber = 1;
    while (bells.some((b) => b.lessonNumber === lessonNumber)) lessonNumber++;
    return { lessonNumber, start: '', end: '' };
  }
  const last = ordered.at(-1);
  if (!last) return { lessonNumber, start: '', end: '' };
  const prev = ordered.at(-2);
  const length = minutesOf(last.end) - minutesOf(last.start) || 45;
  const rest = prev ? minutesOf(last.start) - minutesOf(prev.end) : 10;
  const start = minutesOf(last.end) + Math.max(0, rest);
  if (start + length >= 24 * 60) return { lessonNumber, start: '', end: '' };
  return { lessonNumber, start: hhmm(start), end: hhmm(start + length) };
}
/**
 * Государственные праздники учебного года, выпадающие на учебное время.
 * Переносы выходных каждый год разные — их учитель добавляет сам.
 */
export function publicHolidays(now: Date): Omit<DayOff, 'id'>[] {
  const y = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const n = y + 1;
  return [
    { title: 'День народного единства', start: `${y}-11-04`, end: `${y}-11-04` },
    { title: 'Новогодние праздники', start: `${n}-01-01`, end: `${n}-01-08` },
    { title: 'День защитника Отечества', start: `${n}-02-23`, end: `${n}-02-23` },
    { title: 'Международный женский день', start: `${n}-03-08`, end: `${n}-03-08` },
    { title: 'Праздник Весны и Труда', start: `${n}-05-01`, end: `${n}-05-01` },
    { title: 'День Победы', start: `${n}-05-09`, end: `${n}-05-09` },
  ];
}
/** Сколько дней хранить прошедшие заметки: они про конкретный день, не архив. */
export const NOTES_KEEP_DAYS = 60;
export const NOTE_MAX_LENGTH = 300;
/** Ставит, меняет или (пустой текст) убирает заметку; заодно забывает давно прошедшие. */
export function setNote(
  notes: LessonNote[],
  date: string,
  lessonNumber: number,
  text: string,
  today = new Date(),
): LessonNote[] {
  const oldest = isoDate(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - NOTES_KEEP_DAYS),
  );
  const rest = notes.filter(
    (n) => n.date >= oldest && !(n.date === date && n.lessonNumber === lessonNumber),
  );
  const value = text.trim().slice(0, NOTE_MAX_LENGTH);
  return value ? [...rest, { date, lessonNumber, text: value }] : rest;
}
export function gaps(lessons: Lesson[]): number[] {
  const sorted = [...lessons].sort((a, b) => a.lessonNumber - b.lessonNumber);
  if (!sorted.length) return [];
  const numbers = new Set(sorted.map((l) => l.lessonNumber));
  const result: number[] = [];
  for (let n = sorted[0].lessonNumber + 1; n < sorted.at(-1)!.lessonNumber; n++)
    if (!numbers.has(n)) result.push(n);
  return result;
}
function validTime(start: string, end: string) {
  const pattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  return pattern.test(start) && pattern.test(end) && start < end;
}
function validNumber(n: number) {
  return Number.isInteger(n) && n >= 1 && n <= 20;
}
function validateBells(bells: LessonTime[], prefix: string, errors: string[]) {
  const bellNumbers = new Set<number>();
  for (const bell of bells) {
    if (!validNumber(bell.lessonNumber) || bellNumbers.has(bell.lessonNumber))
      errors.push(`${prefix}Номера звонков должны быть уникальными, от 1 до 20.`);
    bellNumbers.add(bell.lessonNumber);
    if (!validTime(bell.start, bell.end))
      errors.push(`${prefix}Звонок ${bell.lessonNumber}: укажите время начала раньше окончания.`);
  }
  const ordered = [...bells].sort((a, b) => a.lessonNumber - b.lessonNumber);
  for (let i = 1; i < ordered.length; i++)
    if (ordered[i].start < ordered[i - 1].end)
      errors.push(`${prefix}Звонки должны идти по порядку и не пересекаться.`);
}
export function validate(data: AppData): string[] {
  const errors: string[] = [];
  validateBells(data.bells, '', errors);
  const ids = new Set<string>();
  for (const lesson of data.lessons) {
    if (!lesson.id || ids.has(lesson.id))
      errors.push('Идентификаторы уроков должны быть уникальными.');
    ids.add(lesson.id);
    if (!Number.isInteger(lesson.weekday) || lesson.weekday < 1 || lesson.weekday > 5)
      errors.push('Занятия доступны только с понедельника по пятницу.');
    if (!validNumber(lesson.lessonNumber)) errors.push('Номер урока должен быть от 1 до 20.');
    if (!lesson.className.trim())
      errors.push(
        'Укажите класс для каждого урока. Если урока нет, удалите его кнопкой × — пропущенный номер станет окном.',
      );
    if (lesson.customTime && !validTime(lesson.customTime.start, lesson.customTime.end))
      errors.push(`Урок ${lesson.lessonNumber}: проверьте индивидуальное время.`);
  }
  for (let day = 1; day <= 5; day++) {
    const lessons = lessonsForDay(data.lessons, day);
    const numbers = new Set<number>();
    let previousEnd: string | undefined;
    for (const lesson of lessons) {
      if (numbers.has(lesson.lessonNumber))
        errors.push(`${weekdays[day - 1]}: номер урока повторяется.`);
      numbers.add(lesson.lessonNumber);
      const time = timeOf(lesson, data.bells);
      if (time) {
        if (previousEnd && time.start < previousEnd)
          errors.push(
            `${weekdays[day - 1]}: время уроков пересекается или не соответствует их порядку.`,
          );
        previousEnd = time.end;
      }
    }
  }
  for (const h of data.holidays) {
    if (!validDate(h.start) || !validDate(h.end))
      errors.push('Каникулы и праздники: укажите даты начала и окончания.');
    else if (h.end < h.start)
      errors.push(
        `Каникулы и праздники: «${h.title.trim() || 'без названия'}» заканчиваются раньше, чем начинаются.`,
      );
  }
  const shortDays = new Set<string>();
  for (const date of data.shortDays) {
    if (!validDate(date)) errors.push('Сокращённые дни: укажите дату.');
    else if (shortDays.has(date)) errors.push('Сокращённые дни: дата повторяется.');
    shortDays.add(date);
  }
  validateBells(data.shortBells, 'Сокращённые звонки: ', errors);
  return [...new Set(errors)];
}
const isText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
export function decode(raw: string): AppData {
  if (raw.length > 1_000_000) throw new Error('Файл слишком большой. Максимум — 1 МБ.');
  const data = JSON.parse(raw) as AppData;
  if (
    data?.version !== 1 ||
    !Array.isArray(data.lessons) ||
    !Array.isArray(data.bells) ||
    !data.settings
  )
    throw new Error('Неподдерживаемый формат данных.');
  normalize(data);
  const s = data.settings;
  if (
    data.lessons.length > 100 ||
    data.bells.length > 20 ||
    (data.onboardingComplete !== undefined && typeof data.onboardingComplete !== 'boolean')
  )
    throw new Error('Некорректная структура расписания.');
  if (
    ![s.launchOnStartup, s.alwaysOnTop, s.locked, s.checkUpdates].every(
      (v) => typeof v === 'boolean',
    ) ||
    !['compact', 'normal'].includes(s.widgetSize) ||
    !widgetCorners.includes(s.widgetCorner) ||
    !['system', 'light', 'dark'].includes(s.theme) ||
    !['tray', 'exit'].includes(s.closeBehavior) ||
    !Number.isFinite(s.opacity) ||
    s.opacity < 80 ||
    s.opacity > 100
  )
    throw new Error('Повреждены настройки.');
  for (const l of data.lessons) {
    if (
      !l ||
      typeof l.id !== 'string' ||
      typeof l.className !== 'string' ||
      typeof l.subject !== 'string' ||
      typeof l.room !== 'string' ||
      [l.id, l.className, l.subject, l.room].some((v) => v.length > 200)
    )
      throw new Error('Повреждены данные уроков.');
    if (
      l.customTime !== undefined &&
      (!l.customTime ||
        typeof l.customTime.start !== 'string' ||
        typeof l.customTime.end !== 'string')
    )
      throw new Error('Повреждено индивидуальное время.');
  }
  for (const b of [...data.bells, ...(Array.isArray(data.shortBells) ? data.shortBells : [])])
    if (!b || typeof b.start !== 'string' || typeof b.end !== 'string')
      throw new Error('Повреждены данные звонков.');
  if (
    !Array.isArray(data.holidays) ||
    !Array.isArray(data.shortDays) ||
    !Array.isArray(data.shortBells) ||
    !Array.isArray(data.notes) ||
    data.holidays.length > 100 ||
    data.shortDays.length > 200 ||
    data.shortBells.length > 20 ||
    data.notes.length > 2000 ||
    data.holidays.some(
      (h) =>
        !h ||
        !isText(h.id, 200) ||
        !isText(h.title, 100) ||
        !isText(h.start, 10) ||
        !isText(h.end, 10),
    ) ||
    data.shortDays.some((d) => !isText(d, 10)) ||
    data.notes.some(
      (n) =>
        !n ||
        !validDate(n.date) ||
        !validNumber(n.lessonNumber) ||
        !isText(n.text, NOTE_MAX_LENGTH),
    )
  )
    throw new Error('Повреждены каникулы, сокращённые дни или заметки.');
  const errors = validate(data);
  if (errors.length) throw new Error(errors.join(' '));
  return data;
}
