import { describe, expect, it } from 'vitest';
import { emptyData, type AppData } from './domain';
import { PLAN_DAYS, buildPlan, defaultPhoneSettings } from './phone';
const data: AppData = {
  ...emptyData(),
  lessons: [
    { id: 'a', weekday: 1, lessonNumber: 1, className: '7Б', subject: 'Алгебра', room: '214' },
    { id: 'b', weekday: 1, lessonNumber: 2, className: '8А', subject: '', room: '' },
    { id: 'c', weekday: 1, lessonNumber: 9, className: 'без звонка', subject: '', room: '' },
  ],
  bells: [
    { lessonNumber: 1, start: '08:30', end: '09:15' },
    { lessonNumber: 2, start: '09:25', end: '10:10' },
  ],
  shortDays: ['2026-10-12'],
  shortBells: [{ lessonNumber: 1, start: '08:30', end: '09:00' }],
  holidays: [{ id: 'h', title: 'Осенние каникулы', start: '2026-10-26', end: '2026-11-03' }],
  notes: [{ date: '2026-10-05', lessonNumber: 2, text: 'контрольная' }],
};
describe('план для телефона', () => {
  const plan = buildPlan(data, defaultPhoneSettings, new Date(2026, 9, 5));
  const day = (date: string) => plan.days.find((d) => d.date === date)!;
  it('без авто-цветов полоска урока пустая', () => {
    const plain = buildPlan(
      { ...data, settings: { ...data.settings, autoColors: false } },
      defaultPhoneSettings,
      new Date(2026, 9, 5),
    );
    expect(plain.days[0].lessons.map((l) => l.color)).toEqual(['', '']);
  });
  it('охватывает несколько недель подряд', () => {
    expect(plan.days).toHaveLength(PLAN_DAYS);
    expect(plan.days[0].date).toBe('2026-10-05');
  });
  it('уроки со временем и заметками, без уроков без звонка', () => {
    expect(day('2026-10-05').lessons).toEqual([
      {
        number: 1,
        className: '7Б',
        subject: 'Алгебра',
        room: '214',
        start: '08:30',
        end: '09:15',
        note: '',
        color: '#f43f5e',
      },
      {
        number: 2,
        className: '8А',
        subject: '',
        room: '',
        start: '09:25',
        end: '10:10',
        note: 'контрольная',
        color: '#3b82f6',
      },
    ]);
    expect(day('2026-10-06').lessons).toEqual([]);
  });
  it('сокращённые звонки и каникулы', () => {
    expect(day('2026-10-12')).toMatchObject({ short: true, lessons: [{ end: '09:00' }, {}] });
    expect(day('2026-10-26')).toMatchObject({
      off: 'Осенние каникулы · до 3 ноября',
      lessons: [],
    });
  });
});
