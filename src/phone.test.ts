// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { emptyData, type AppData } from './domain';
import { PLAN_DAYS, buildPlan, defaultPhoneSettings, loadPhoneSettings } from './phone';
// «Плюс» в тестах включается и выключается: по умолчанию — куплен.
const plus = vi.hoisted(() => ({ on: true }));
vi.mock('./plus', () => ({
  hasPlus: () => plus.on,
  showsPlus: () => plus.on,
  PLUS_ON_SALE: false,
}));
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
  it('звук напоминаний и сводки уходит в план; старые настройки получают перезвон', () => {
    localStorage.setItem(
      'teacher-companion-phone-v1',
      JSON.stringify({ ongoing: false, remind: 10, morning: true, morningTime: '07:00' }),
    );
    const saved = loadPhoneSettings();
    expect(saved).toMatchObject({ remind: 10, remindSound: 'chime', morningSound: 'chime' });
    // Новое после обновления: вибрация за 5 минут до звонка, тишина на уроках, вечер выключен.
    expect(saved).toMatchObject({
      ending: 5,
      endingSound: 'vibrate',
      endingText: 'Пора подводить итоги и задавать ДЗ',
      evening: false,
      eveningTime: '19:00',
      quiet: true,
    });
    const quiet = buildPlan(data, { ...saved, morningSound: 'vibrate' }, new Date(2026, 9, 5));
    expect(quiet.settings).toMatchObject({ remindSound: 'chime', morningSound: 'vibrate' });
    localStorage.clear();
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
  it('без «Плюса»: в плане только урок в шторке и утренняя сводка, без цветов', () => {
    plus.on = false;
    const free = buildPlan(
      data,
      {
        ...defaultPhoneSettings,
        remind: 10,
        ending: 5,
        evening: true,
        morning: true,
        quiet: true,
        morningSound: 'silent',
      },
      new Date(2026, 9, 5),
    );
    plus.on = true;
    expect(free.settings).toMatchObject({
      ongoing: true,
      morning: true,
      morningSound: 'chime',
      remind: 0,
      ending: 0,
      evening: false,
      quiet: false,
    });
    expect(free.days[0].lessons.map((l) => l.color)).toEqual(['', '']);
  });
});
