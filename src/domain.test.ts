import { describe, it, expect } from 'vitest';
import {
  autoDayMode,
  emptyData,
  getNextSchoolDay,
  gaps,
  validate,
  decode,
  timeOf,
  type Lesson,
} from './domain';
const lesson = (weekday = 1, lessonNumber = 1): Lesson => ({
  id: `${weekday}-${lessonNumber}`,
  weekday,
  lessonNumber,
  className: '6А',
  subject: '',
  room: '',
});
describe('следующий учебный день', () => {
  it('пропускает выходные и свободные будни', () =>
    expect(getNextSchoolDay([lesson(2)], new Date(2026, 8, 25))?.getDay()).toBe(2));
  it('ищет строго после сегодняшнего дня', () =>
    expect(getNextSchoolDay([lesson()], new Date(2026, 8, 21))?.getDate()).toBe(28));
  it('возвращает null для пустой недели', () => expect(getNextSchoolDay([])).toBeNull());
  it('переходит через границу года', () =>
    expect(getNextSchoolDay([lesson()], new Date(2026, 11, 31))?.getFullYear()).toBe(2027));
  it('игнорирует случайные субботние записи', () =>
    expect(getNextSchoolDay([lesson(6)])).toBeNull());
});
describe('автоматический выбор дня', () => {
  const data = {
    lessons: [lesson(5, 1), lesson(5, 3)],
    bells: [
      { lessonNumber: 1, start: '08:30', end: '09:15' },
      { lessonNumber: 3, start: '10:20', end: '11:05' },
    ],
  };
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
