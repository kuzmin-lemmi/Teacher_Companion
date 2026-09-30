import { describe, it, expect } from 'vitest';
import { hasChecklist, parseChecklist, toggleChecklistItem, getChecklistStats } from './checklist';
import {
  generateBells,
  nextBell,
  autoDayMode,
  countdown,
  dayOf,
  emptyData,
  getNextSchoolDay,
  gaps,
  validate,
  decode,
  normalize,
  publicHolidays,
  setNote,
  shortenBells,
  timeOf,
  matchColorTag,
  extractParallels,
  type AppData,
  type Lesson,
  type ColorTag,
  lessonColor,
} from './domain';
const lesson = (weekday = 1, lessonNumber = 1): Lesson => ({
  id: `${weekday}-${lessonNumber}`,
  weekday,
  lessonNumber,
  className: '6А',
  subject: '',
  room: '',
});
const week = (lessons: Lesson[], extra: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  lessons,
  ...extra,
});
describe('следующий учебный день', () => {
  it('пропускает выходные и свободные будни', () =>
    expect(getNextSchoolDay(week([lesson(2)]), new Date(2026, 8, 25))?.getDay()).toBe(2));
  it('ищет строго после сегодняшнего дня', () =>
    expect(getNextSchoolDay(week([lesson()]), new Date(2026, 8, 21))?.getDate()).toBe(28));
  it('возвращает null для пустой недели', () => expect(getNextSchoolDay(week([]))).toBeNull());
  it('переходит через границу года', () =>
    expect(getNextSchoolDay(week([lesson()]), new Date(2026, 11, 31))?.getFullYear()).toBe(2027));
  it('игнорирует случайные субботние записи', () =>
    expect(getNextSchoolDay(week([lesson(6)]))).toBeNull());
});
describe('автоматический выбор дня', () => {
  const data = week([lesson(5, 1), lesson(5, 3)], {
    bells: [
      { lessonNumber: 1, start: '08:30', end: '09:15' },
      { lessonNumber: 3, start: '10:20', end: '11:05' },
    ],
  });
  it('утром и во время уроков показывает сегодня', () => {
    expect(autoDayMode(data, new Date(2026, 8, 25, 7))).toBe('today');
    expect(autoDayMode(data, new Date(2026, 8, 25, 10, 30))).toBe('today');
  });
  it('после последнего урока переключается на следующий день', () =>
    expect(autoDayMode(data, new Date(2026, 8, 25, 11, 5))).toBe('next'));
  it('в день без уроков показывает следующий', () =>
    expect(autoDayMode(data, new Date(2026, 8, 24, 8))).toBe('next'));
  it('учитывает индивидуальное время последнего урока', () =>
    expect(
      autoDayMode(
        {
          ...data,
          lessons: [
            ...data.lessons,
            { ...lesson(5, 4), customTime: { start: '12:00', end: '12:45' } },
          ],
        },
        new Date(2026, 8, 25, 12, 10),
      ),
    ).toBe('today'));
  it('без известного времени показывает следующий день', () =>
    expect(autoDayMode({ ...data, bells: [] }, new Date(2026, 8, 25, 7))).toBe('next'));
});
it('находит только внутренние пропущенные номера', () =>
  expect(gaps([lesson(1, 5), lesson(1, 2), lesson(1, 4)])).toEqual([3]));
it('индивидуальное время имеет приоритет', () =>
  expect(
    timeOf({ ...lesson(), customTime: { start: '10:00', end: '10:45' } }, [
      { lessonNumber: 1, start: '08:30', end: '09:15' },
    ])?.start,
  ).toBe('10:00'));
describe('валидация', () => {
  it('разрешает расписание без звонков', () =>
    expect(validate({ ...emptyData(), lessons: [lesson()] })).toEqual([]));
  it('запрещает повтор номера и пустой класс', () =>
    expect(
      validate({
        ...emptyData(),
        lessons: [lesson(), { ...lesson(), id: 'other', className: ' ' }],
      }).length,
    ).toBe(2));
  it('запрещает пересечение индивидуального и общего времени', () =>
    expect(
      validate({
        ...emptyData(),
        bells: [{ lessonNumber: 1, start: '08:30', end: '09:15' }],
        lessons: [lesson(), { ...lesson(1, 2), customTime: { start: '09:00', end: '09:45' } }],
      }).join(),
    ).toContain('пересекается'));
  it('проверяет изменение звонков на всей неделе', () =>
    expect(
      validate({
        ...emptyData(),
        bells: [{ lessonNumber: 1, start: '08:30', end: '10:00' }],
        lessons: [lesson(3), { ...lesson(3, 2), customTime: { start: '09:30', end: '10:15' } }],
      }).join(),
    ).toContain('Среда'));
  it('разрешает соседние уроки без перерыва', () =>
    expect(
      validate({
        ...emptyData(),
        lessons: [
          { ...lesson(), customTime: { start: '08:30', end: '09:15' } },
          { ...lesson(1, 2), customTime: { start: '09:15', end: '10:00' } },
        ],
      }),
    ).toEqual([]));
  it('отклоняет неправильное время и выходные', () =>
    expect(
      validate({
        ...emptyData(),
        bells: [{ lessonNumber: 1, start: '24:00', end: '25:00' }],
        lessons: [lesson(6)],
      }),
    ).toHaveLength(2));
  it('отклоняет поврежденные данные', () => {
    expect(() => decode('{bad')).toThrow();
    expect(() => decode('{"version":2}')).toThrow();
    expect(() => decode(JSON.stringify({ ...emptyData(), settings: {} }))).toThrow();
  });
  it('принимает старые копии без угла виджета и проверяет угол', () => {
    const { widgetCorner: _, ...old } = emptyData().settings;
    expect(decode(JSON.stringify({ ...emptyData(), settings: old })).settings.widgetCorner).toBe(
      'top-right',
    );
    const wrong = { ...emptyData().settings, widgetCorner: 'center' };
    expect(() => decode(JSON.stringify({ ...emptyData(), settings: wrong }))).toThrow();
  });
});
describe('отсчёт времени', () => {
  const lessons = [lesson(1, 1), lesson(1, 2), lesson(1, 4)];
  const bells = [
    { lessonNumber: 1, start: '08:00', end: '08:45' },
    { lessonNumber: 2, start: '08:55', end: '09:40' },
    { lessonNumber: 4, start: '10:45', end: '11:30' },
  ];
  const at = (h: number, m: number, s = 0) => {
    const now = new Date(2026, 8, 28, h, m, s);
    return countdown(dayOf(week(lessons, { bells }), now), now);
  };
  it('во время урока считает минуты до звонка', () =>
    expect(at(8, 22)).toEqual({ kind: 'lesson', lessonId: '1-1', minutes: 23, progress: 22 / 45 }));
  it('округляет вверх: последние секунды — это «1 мин»', () =>
    expect(at(8, 44, 30)).toMatchObject({ kind: 'lesson', minutes: 1 }));
  it('со звонком переключается на перемену', () =>
    expect(at(8, 45)).toEqual({ kind: 'break', lessonId: '1-2', minutes: 10 }));
  it('урок начался — отсчёт до его конца', () =>
    expect(at(8, 55)).toMatchObject({ kind: 'lesson', lessonId: '1-2', minutes: 45 }));
  it('в окне считает до следующего урока, но не раньше чем за час', () => {
    expect(at(9, 40)).toBeNull();
    expect(at(9, 45)).toEqual({ kind: 'break', lessonId: '1-4', minutes: 60 });
  });
  it('утром — до первого урока, ночью и после уроков — ничего', () => {
    expect(at(7, 30)).toMatchObject({ kind: 'break', lessonId: '1-1', minutes: 30 });
    expect(at(3, 0)).toBeNull();
    expect(at(11, 30)).toBeNull();
  });
  it('учитывает индивидуальное время урока', () =>
    expect(
      countdown(
        dayOf(
          week([{ ...lesson(1, 1), customTime: { start: '08:00', end: '08:30' } }], { bells }),
          new Date(2026, 8, 28),
        ),
        new Date(2026, 8, 28, 8, 10),
      ),
    ).toMatchObject({ minutes: 20 }));
});
describe('каникулы и праздники', () => {
  const autumn = { id: 'a', title: 'Осенние каникулы', start: '2026-10-26', end: '2026-11-03' };
  const data = week([lesson(1, 1), lesson(5, 1)], {
    bells: [{ lessonNumber: 1, start: '08:00', end: '08:45' }],
    holidays: [autumn, { id: 'b', title: '', start: '2026-11-04', end: '2026-11-04' }],
  });
  it('следующий учебный день — после каникул и праздника', () =>
    expect(getNextSchoolDay(data, new Date(2026, 9, 23))).toEqual(new Date(2026, 10, 6)));
  it('в каникулы виджет не показывает сегодняшние уроки', () => {
    const monday = new Date(2026, 9, 26, 7);
    expect(dayOf(data, monday)).toMatchObject({ off: autumn, lessons: [] });
    expect(autoDayMode(data, monday)).toBe('next');
    expect(countdown(dayOf(data, monday), monday)).toBeNull();
  });
  it('находит учебный день и через летние каникулы', () =>
    expect(
      getNextSchoolDay(
        { ...data, holidays: [{ id: 's', title: 'Лето', start: '2027-05-29', end: '2027-08-31' }] },
        new Date(2027, 4, 28),
      ),
    ).toEqual(new Date(2027, 8, 3)));
  it('праздники учебного года — с сентября по август', () => {
    const autumnList = publicHolidays(new Date(2026, 8, 1));
    expect(autumnList[0].start).toBe('2026-11-04');
    expect(autumnList.at(-1)!.start).toBe('2027-05-09');
    expect(publicHolidays(new Date(2027, 2, 1))[0].start).toBe('2026-11-04');
  });
  it('проверяет даты периодов', () => {
    expect(validate({ ...data, holidays: [{ ...autumn, end: '2026-10-01' }] }).join()).toContain(
      'заканчиваются раньше',
    );
    expect(validate({ ...data, holidays: [{ ...autumn, start: '' }] }).join()).toContain(
      'укажите даты',
    );
  });
});
describe('сокращённые дни', () => {
  const bells = [
    { lessonNumber: 1, start: '08:00', end: '08:45' },
    { lessonNumber: 2, start: '08:55', end: '09:40' },
    { lessonNumber: 3, start: '09:50', end: '10:35' },
  ];
  const shortBells = [
    { lessonNumber: 1, start: '08:00', end: '08:30' },
    { lessonNumber: 2, start: '08:40', end: '09:10' },
  ];
  const data = week(
    [lesson(1, 1), { ...lesson(1, 2), customTime: { start: '09:00', end: '09:45' } }, lesson(1, 3)],
    { bells, shortBells, shortDays: ['2026-09-28'] },
  );
  it('в сокращённый день время берётся из сокращённых звонков', () => {
    const day = dayOf(data, new Date(2026, 8, 28));
    expect(day.short).toBe(true);
    expect(day.lessons.map((l) => day.time(l)?.start)).toEqual(['08:00', '08:40', '09:50']);
    expect(day.bell(2)?.end).toBe('09:10');
  });
  it('в обычный день — обычное и индивидуальное время', () => {
    const day = dayOf(data, new Date(2026, 9, 5));
    expect(day.short).toBe(false);
    expect(day.lessons.map((l) => day.time(l)?.start)).toEqual(['08:00', '09:00', '09:50']);
  });
  it('без сокращённых звонков день не считается сокращённым', () =>
    expect(dayOf({ ...data, shortBells: [] }, new Date(2026, 8, 28)).short).toBe(false));
  it('отсчёт идёт по сокращённому времени', () => {
    const now = new Date(2026, 8, 28, 8, 20);
    expect(countdown(dayOf(data, now), now)).toMatchObject({ kind: 'lesson', minutes: 10 });
  });
  it('рассчитывает сокращённые звонки от начала первого урока', () =>
    expect(shortenBells(bells, 30, 10)).toEqual(
      shortBells.concat({
        lessonNumber: 3,
        start: '09:20',
        end: '09:50',
      }),
    ));
  it('проверяет даты и сокращённые звонки', () => {
    const errors = validate({
      ...data,
      shortDays: ['2026-09-28', '2026-09-28', 'завтра'],
      shortBells: [{ lessonNumber: 1, start: '09:00', end: '08:00' }],
    }).join();
    expect(errors).toContain('дата повторяется');
    expect(errors).toContain('укажите дату');
    expect(errors).toContain('Сокращённые звонки: Звонок 1');
  });
});
describe('заметки к урокам', () => {
  const today = new Date(2026, 8, 28);
  it('добавляет, меняет и убирает пустой текст', () => {
    let notes = setNote([], '2026-09-29', 2, '  сдать тетради  ', today);
    expect(notes).toEqual([{ date: '2026-09-29', lessonNumber: 2, text: 'сдать тетради' }]);
    notes = setNote(notes, '2026-09-29', 2, 'контрольная', today);
    expect(notes).toEqual([{ date: '2026-09-29', lessonNumber: 2, text: 'контрольная' }]);
    expect(setNote(notes, '2026-09-29', 2, '   ', today)).toEqual([]);
  });
  it('забывает заметки старше двух месяцев', () =>
    expect(
      setNote(
        [
          { date: '2026-07-01', lessonNumber: 1, text: 'давно' },
          { date: '2026-09-01', lessonNumber: 1, text: 'недавно' },
        ],
        '2026-09-28',
        1,
        'сегодня',
        today,
      ).map((n) => n.text),
    ).toEqual(['недавно', 'сегодня']));
  it('показывает заметку своего дня и номера урока', () => {
    const data = week([lesson(1, 1), lesson(1, 2)], {
      notes: [{ date: '2026-09-28', lessonNumber: 2, text: 'проектор' }],
    });
    const day = dayOf(data, today);
    expect([day.note(1), day.note(2)]).toEqual(['', 'проектор']);
    expect(dayOf(data, new Date(2026, 9, 5)).note(2)).toBe('');
  });
});
describe('совместимость', () => {
  it('копия без календаря и заметок читается с пустыми списками', () => {
    const { holidays: _h, shortDays: _d, shortBells: _b, notes: _n, ...old } = emptyData();
    expect(decode(JSON.stringify(old))).toMatchObject({
      holidays: [],
      shortDays: [],
      shortBells: [],
      notes: [],
    });
  });
  it('отклоняет повреждённые заметки', () =>
    expect(() =>
      decode(
        JSON.stringify({
          ...emptyData(),
          notes: [{ date: 'вчера', lessonNumber: 1, text: 'x' }],
        }),
      ),
    ).toThrow('заметки'));
});
describe('звонки с нуля', () => {
  it('строит уроки и перемены от первого звонка', () => {
    expect(generateBells('08:00', 3, 45, 10)).toEqual([
      { lessonNumber: 1, start: '08:00', end: '08:45' },
      { lessonNumber: 2, start: '08:55', end: '09:40' },
      { lessonNumber: 3, start: '09:50', end: '10:35' },
    ]);
  });
  it('не переходит за полночь', () => {
    expect(generateBells('22:30', 5, 45, 10)).toHaveLength(1);
  });
  it('следующий звонок повторяет длину урока и перемены', () => {
    const bells = [
      { lessonNumber: 1, start: '08:00', end: '08:40' },
      { lessonNumber: 2, start: '08:55', end: '09:35' },
    ];
    expect(nextBell(bells)).toEqual({ lessonNumber: 3, start: '09:50', end: '10:30' });
    expect(nextBell([bells[0]])).toEqual({ lessonNumber: 2, start: '08:50', end: '09:30' });
    expect(nextBell([])).toEqual({ lessonNumber: 1, start: '', end: '' });
  });
  it('следующий звонок идёт за последним номером, даже если в середине пропуск', () => {
    const bells = [
      { lessonNumber: 1, start: '08:30', end: '09:15' },
      { lessonNumber: 2, start: '09:25', end: '10:10' },
      { lessonNumber: 3, start: '10:20', end: '11:05' },
      { lessonNumber: 5, start: '12:10', end: '12:55' },
    ];
    const added = nextBell(bells);
    expect(added.lessonNumber).toBe(6);
    expect(validate({ ...emptyData(), bells: [...bells, added] })).toEqual([]);
    // Дальше 20-го — первый свободный номер без времени.
    const full = Array.from({ length: 19 }, (_, i) => ({ ...bells[0], lessonNumber: i + 2 }));
    expect(nextBell(full)).toEqual({ lessonNumber: 1, start: '', end: '' });
  });
});

describe('цветовая маркировка (теги классов и предметов)', () => {
  const tags: ColorTag[] = [
    { id: '1', target: 'class', pattern: '5', color: 'blue' },
    { id: '2', target: 'class', pattern: '7А', color: 'amber' },
    { id: '3', target: 'subject', pattern: 'Математика', color: 'emerald' },
  ];

  it('сопоставляет параллель по числу', () => {
    expect(matchColorTag({ ...lesson(), className: '5А' }, tags)?.color).toBe('blue');
    expect(matchColorTag({ ...lesson(), className: '5-Б' }, tags)?.color).toBe('blue');
    expect(matchColorTag({ ...lesson(), className: '5' }, tags)?.color).toBe('blue');
    // Не должно ложно срабатывать на 15 или 55
    expect(matchColorTag({ ...lesson(), className: '15' }, tags)).toBeUndefined();
    expect(matchColorTag({ ...lesson(), className: '50А' }, tags)).toBeUndefined();
  });

  it('сопоставляет конкретный класс', () => {
    expect(matchColorTag({ ...lesson(), className: '7А' }, tags)?.color).toBe('amber');
    expect(matchColorTag({ ...lesson(), className: '7Б' }, tags)).toBeUndefined();
  });

  it('сопоставляет предмет по вхождению подстроки без учёта регистра', () => {
    expect(
      matchColorTag({ ...lesson(), className: '8Б', subject: 'Математика (база)' }, tags)?.color,
    ).toBe('emerald');
    expect(
      matchColorTag({ ...lesson(), className: '8Б', subject: 'Физика' }, tags),
    ).toBeUndefined();
  });

  it('извлекает список параллелей из уроков', () => {
    const list = [
      { ...lesson(), className: '9А' },
      { ...lesson(), className: '5Б' },
      { ...lesson(), className: '9В' },
      { ...lesson(), className: '11А' },
      { ...lesson(), className: 'Факультатив' },
    ];
    expect(extractParallels(list)).toEqual(['5', '9', '11']);
  });

  it('сохраняет и декодирует теги в настройках', () => {
    const data = {
      ...emptyData(),
      settings: {
        ...emptyData().settings,
        colorTags: tags,
      },
    };
    const decoded = decode(JSON.stringify(data));
    expect(decoded.settings.colorTags).toEqual(tags);
  });
});

describe('чек-листы в заметках к урокам', () => {
  it('распознаёт наличие чекбокса', () => {
    expect(hasChecklist('Обычная заметка')).toBe(false);
    expect(hasChecklist('[ ] Раздать тетради')).toBe(true);
    expect(hasChecklist('[x] Собрать контрольные')).toBe(true);
  });

  it('разбирает чек-лист на элементы', () => {
    const note = 'Важно: [ ] Раздать тетради [x] Собрать работы';
    const parts = parseChecklist(note);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ kind: 'text', text: 'Важно:' });
    expect(parts[1]).toEqual({ kind: 'item', index: 0, done: false, text: 'Раздать тетради' });
    expect(parts[2]).toEqual({ kind: 'item', index: 1, done: true, text: 'Собрать работы' });
  });

  it('переключает состояние конкретного чекбокса', () => {
    const initial = '[ ] Первая задача; [ ] Вторая задача';
    const toggled = toggleChecklistItem(initial, 0);
    expect(toggled).toBe('[x] Первая задача; [ ] Вторая задача');

    const toggledBack = toggleChecklistItem(toggled, 0);
    expect(toggledBack).toBe('[ ] Первая задача; [ ] Вторая задача');

    const toggledSecond = toggleChecklistItem(initial, 1);
    expect(toggledSecond).toBe('[ ] Первая задача; [x] Вторая задача');
  });

  it('считает прогресс чек-листа', () => {
    expect(getChecklistStats('нет чекбокса')).toEqual({ total: 0, done: 0 });
    expect(getChecklistStats('[ ] Один, [x] Два, [X] Три')).toEqual({ total: 3, done: 2 });
  });
});

describe('настройки напоминаний о звонках', () => {
  it('имеет включенные напоминания по умолчанию', () => {
    const data = emptyData();
    expect(data.settings.bellAlertMinutes).toBe(5);
    expect(data.settings.bellAlertSound).toBe(true);
    expect(data.settings.bellAlertPopup).toBe(true);
    expect(data.settings.bellAlertMessage).toBe('Пора подводить итоги и задавать ДЗ');
  });

  it('нормализует старые копии без настроек звонков', () => {
    const old = {
      ...emptyData(),
      settings: {
        launchOnStartup: false,
        alwaysOnTop: false,
        locked: false,
        widgetSize: 'compact' as const,
        widgetCorner: 'top-right' as const,
        opacity: 100,
        theme: 'dark' as const,
        closeBehavior: 'tray' as const,
        checkUpdates: true,
      } as unknown as AppData['settings'],
    };
    normalize(old);
    expect(old.settings.bellAlertMinutes).toBe(5);
    expect(old.settings.bellAlertSound).toBe(true);
  });

  it('валидирует и отклоняет некорректные минуты звонка', () => {
    expect(() =>
      decode(
        JSON.stringify({
          ...emptyData(),
          settings: {
            ...emptyData().settings,
            bellAlertMinutes: -5,
          },
        }),
      ),
    ).toThrow('Повреждены настройки');
  });
});

describe('lessonColor', () => {
  const lesson = { className: '5Б', subject: 'Математика' } as Lesson;
  it('is stable per subject and can be turned off', () => {
    const on = { colorTags: [], autoColors: true };
    expect(lessonColor(lesson, on)).toBe(lessonColor({ ...lesson, className: '7А' } as Lesson, on));
    expect(lessonColor(lesson, { colorTags: [], autoColors: false })).toBeUndefined();
  });
  it('prefers a manual tag', () => {
    const tags = [{ id: 't', target: 'subject' as const, pattern: 'матем', color: 'rose' }];
    expect(lessonColor(lesson, { colorTags: tags, autoColors: true })).toBe('rose');
  });
});
