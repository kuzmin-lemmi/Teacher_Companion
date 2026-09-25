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
};
export type AppData = {
  version: 1;
  lessons: Lesson[];
  bells: LessonTime[];
  settings: Settings;
  onboardingComplete?: boolean;
};
export const emptyData = (): AppData => ({
  version: 1,
  onboardingComplete: false,
  lessons: [],
  bells: [],
  settings: {
    launchOnStartup: false,
    alwaysOnTop: false,
    locked: false,
    widgetSize: 'compact',
    widgetCorner: 'top-right',
    opacity: 100,
    theme: 'dark',
    closeBehavior: 'tray',
  },
});
export function timeOf(lesson: Lesson, bells: LessonTime[]) {
  return lesson.customTime ?? bells.find((b) => b.lessonNumber === lesson.lessonNumber);
}
export function lessonsForDay(lessons: Lesson[], weekday: number) {
  return lessons
    .filter((l) => l.weekday === weekday)
    .sort((a, b) => a.lessonNumber - b.lessonNumber);
}
export function getNextSchoolDay(lessons: Lesson[], today = new Date()): Date | null {
  for (let offset = 1; offset <= 7; offset++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (
      date.getDay() >= 1 &&
      date.getDay() <= 5 &&
      lessons.some((l) => l.weekday === date.getDay())
    )
      return date;
  }
  return null;
}
export type DayMode = 'today' | 'next';
/** Сегодня — пока не закончился последний урок с известным временем, затем следующий учебный день. */
export function autoDayMode(data: Pick<AppData, 'lessons' | 'bells'>, now: Date): DayMode {
  const clock = now.toTimeString().slice(0, 5);
  const ends = lessonsForDay(data.lessons, now.getDay())
    .map((l) => timeOf(l, data.bells)?.end)
    .filter((end): end is string => !!end);
  return ends.some((end) => clock < end) ? 'today' : 'next';
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
export function validate(data: AppData): string[] {
  const errors: string[] = [];
  const bellNumbers = new Set<number>();
  for (const bell of data.bells) {
    if (!validNumber(bell.lessonNumber) || bellNumbers.has(bell.lessonNumber))
      errors.push('Номера звонков должны быть уникальными, от 1 до 20.');
    bellNumbers.add(bell.lessonNumber);
    if (!validTime(bell.start, bell.end))
      errors.push(`Звонок ${bell.lessonNumber}: укажите время начала раньше окончания.`);
  }
  const orderedBells = [...data.bells].sort((a, b) => a.lessonNumber - b.lessonNumber);
  for (let i = 1; i < orderedBells.length; i++)
    if (orderedBells[i].start < orderedBells[i - 1].end)
      errors.push('Звонки должны идти по порядку и не пересекаться.');
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
  return [...new Set(errors)];
}
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
  const s = data.settings;
  // Копии до версии 0.2 не содержат угла виджета.
  if (s && typeof s === 'object' && s.widgetCorner === undefined) s.widgetCorner = 'top-right';
  if (
    data.lessons.length > 100 ||
    data.bells.length > 20 ||
    (data.onboardingComplete !== undefined && typeof data.onboardingComplete !== 'boolean')
  )
    throw new Error('Некорректная структура расписания.');
  if (
    ![s.launchOnStartup, s.alwaysOnTop, s.locked].every((v) => typeof v === 'boolean') ||
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
  for (const b of data.bells)
    if (!b || typeof b.start !== 'string' || typeof b.end !== 'string')
      throw new Error('Повреждены данные звонков.');
  const errors = validate(data);
  if (errors.length) throw new Error(errors.join(' '));
  return data;
}
