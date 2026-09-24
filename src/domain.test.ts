import { describe, it, expect } from 'vitest';
import { emptyData, getNextSchoolDay, gaps, validate, decode, timeOf, type Lesson } from './domain';
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
});
