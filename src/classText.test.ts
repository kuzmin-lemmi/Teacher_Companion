// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classDay, classDayText, classWeekText, nextClassDay, shareWeekStart } from './classText';
import { emptyData, type AppData } from './domain';
import { parseAscXml } from './school/asc';
import { nextPublication } from './school/publication';
import { applySchool } from './schoolMode';

const manual: AppData = {
  ...emptyData(),
  bells: [
    { lessonNumber: 1, start: '08:00', end: '08:45' },
    { lessonNumber: 2, start: '09:00', end: '09:45' },
  ],
  shortBells: [
    { lessonNumber: 1, start: '08:00', end: '08:30' },
    { lessonNumber: 2, start: '08:40', end: '09:10' },
  ],
  lessons: [
    { id: 'm1', weekday: 5, lessonNumber: 2, className: '8Г', subject: 'Информатика', room: '12' },
  ],
  homeroom: {
    enabled: true,
    className: '8Г',
    lessons: [
      {
        id: 'h1',
        weekday: 5,
        lessonNumber: 1,
        subject: 'Алгебра',
        room: '19',
        teacher: 'Манина С.',
      },
      {
        id: 'h2',
        weekday: 5,
        lessonNumber: 2,
        subject: 'Литература',
        room: '9',
        teacher: 'Хлопцева Е.',
      },
    ],
  },
};
const FRI = new Date(2026, 10, 13);

describe('расписание класса для родителей', () => {
  it('день: свои уроки учителя в классе главнее введённых, время по звонкам', () => {
    expect(classDayText(manual, FRI, { rooms: false, teachers: false })).toBe(
      [
        '📅 8Г — пятница, 13 ноября',
        '',
        '1. 08:00–08:45 Алгебра',
        '2. 09:00–09:45 Информатика',
        '',
        '🔔 Уроки заканчиваются в 09:45',
      ].join('\n'),
    );
    expect(classDayText(manual, FRI, { rooms: true, teachers: true })).toContain(
      '1. 08:00–08:45 Алгебра, каб. 19, Манина С.',
    );
  });

  it('каникулы, сокращённый день, день без уроков', () => {
    const off = {
      ...manual,
      holidays: [{ id: 'x', title: 'Осенние каникулы', start: '2026-11-13', end: '2026-11-13' }],
    };
    expect(classDayText(off, FRI, { rooms: false, teachers: false })).toContain(
      'Уроков нет: Осенние каникулы',
    );
    const short = { ...manual, shortDays: ['2026-11-13'] };
    const t = classDayText(short, FRI, { rooms: false, teachers: false });
    expect(t).toContain('⏱ Сокращённые уроки');
    expect(t).toContain('🔔 Уроки заканчиваются в 09:10');
    expect(
      classDayText(manual, new Date(2026, 10, 12), { rooms: false, teachers: false }),
    ).toContain('Уроков нет');
  });

  it('неделя и следующий учебный день класса', () => {
    const w = classWeekText(manual, new Date(2026, 10, 9), { rooms: false, teachers: false });
    expect(w.split('\n')[0]).toBe('📅 8Г — неделя 9–13 ноября');
    expect(w).toContain('Пятница, 13 ноября · до 09:45');
    expect(w).toContain('Понедельник, 9 ноября\nУроков нет');
    expect(nextClassDay(manual, new Date(2026, 10, 10))!.getDate()).toBe(13);
    expect(shareWeekStart(new Date(2026, 10, 11)).getDate()).toBe(9); // среда — эта неделя
    expect(shareWeekStart(new Date(2026, 10, 12)).getDate()).toBe(16); // четверг — следующая
    expect(shareWeekStart(new Date(2026, 10, 13)).getDate()).toBe(16); // пятница — следующая
    expect(shareWeekStart(new Date(2026, 10, 15)).getDate()).toBe(16); // воскресенье — следующая
  });

  it('школьный режим: замена у класса попадает в текст только на свою дату', () => {
    const base = parseAscXml(readFileSync('src/school/samples/demo-asc.xml', 'utf8'));
    const changed = parseAscXml(readFileSync('src/school/samples/demo-asc-zameny.xml', 'utf8'));
    const school = { id: 'abcd1234efgh5678', name: 'Демо' };
    const cls = base.classes.find((c) => c.name === '5а')!; // в демо-заменах у 5а меняется 2-й урок 13-го
    const t = base.teachers.find((x) => x.name.startsWith('Кузнецов'))!;
    const opt = { school, today: '2026-11-12', homerooms: { [cls.id]: t.id } };
    const p1 = nextPublication(
      null,
      { kind: 'base', validFrom: '2026-11-09', schedule: base },
      opt,
    );
    const p2 = nextPublication(
      p1,
      { kind: 'override', date: '2026-11-13', schedule: changed },
      opt,
    );
    const d = applySchool(
      emptyData(),
      { version: 2, publishedAt: 'x', publication: p2 },
      { server: 'https://x', school: school.id, key: 'k' },
      t.id,
      new Date(2026, 10, 12, 9),
    );
    expect(Object.keys(d.schoolClassDays!)).toEqual(['2026-11-13']);
    const fri13 = classDay(d, FRI).lines.map((l) => l.teacher);
    const fri20 = classDay(d, new Date(2026, 10, 20)).lines.map((l) => l.teacher);
    expect(fri13).not.toEqual(fri20);
    expect(classDayText(d, FRI, { rooms: false, teachers: true })).toContain(
      '📅 5а — пятница, 13 ноября',
    );
  });
});
