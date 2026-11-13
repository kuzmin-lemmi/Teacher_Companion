// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayOf, emptyData, getNextSchoolDay, validate, type AppData } from './domain';
import { parseAscXml } from './school/asc';
import { nextPublication } from './school/publication';
import {
  applySchool,
  checkSchool,
  disconnectSchool,
  teacherChoices,
  teacherLessons,
} from './schoolMode';

const base = parseAscXml(readFileSync('src/school/samples/demo-asc.xml', 'utf8'));
const changed = parseAscXml(readFileSync('src/school/samples/demo-asc-zameny.xml', 'utf8'));
const school = { id: 'abcd1234efgh5678', name: 'Демо-школа' };
const link = { server: 'https://example.ru/fn', school: school.id, key: 'k'.repeat(43) };
const opt = { school, today: '2026-11-12' };
const p1 = nextPublication(null, { kind: 'base', validFrom: '2026-11-09', schedule: base }, opt);
const p2 = nextPublication(p1, { kind: 'override', date: '2026-11-13', schedule: changed }, opt);
const fetched = (publication = p2, version = 2) => ({
  version,
  publishedAt: '2026-11-12T07:40:00Z',
  publication,
});
const NOW = new Date(2026, 10, 12, 9, 0);
const id = (prefix: string) => base.teachers.find((t) => t.name.startsWith(prefix))!.id;

const personal: AppData = {
  ...emptyData(),
  lessons: [
    { id: 'my1', weekday: 1, lessonNumber: 1, className: '5а', subject: 'Своё', room: '1' },
  ],
  bells: [{ lessonNumber: 1, start: '08:00', end: '08:45' }],
};

describe('школьный режим', () => {
  it('«Кто вы?» — учителя с числом уроков', () => {
    const list = teacherChoices(p2, '2026-11-12');
    expect(list.length).toBe(38);
    expect(list.every((t) => t.lessons > 0)).toBe(true);
  });

  it('мои уроки из школы — в обычных уроках приложения, звонки из aSc', () => {
    const d = applySchool(personal, fetched(), link, id('Петрова'), NOW);
    expect(validate(d)).toEqual([]);
    expect(d.lessons.length).toBe(teacherLessons(base, id('Петрова')).length);
    expect(d.lessons.every((l) => l.id.startsWith('school-'))).toBe(true);
    expect(d.bells[0]).toEqual({ lessonNumber: 1, start: '08:30', end: '09:15' });
    expect(d.school).toMatchObject({
      teacherName: 'Петрова А. В.',
      version: 2,
      appliedOn: '2026-11-12',
    });
    expect(d.school!.personal.lessons[0].subject).toBe('Своё');
  });

  it('замена на 13-е — только 13-го; 20-го снова обычная пятница', () => {
    // Петрова на замене 13-го ведёт другие уроки — в демо-заменах «заболела Петрова»
    const d = applySchool(personal, fetched(), link, id('Петрова'), NOW);
    const fri13 = dayOf(d, new Date(2026, 10, 13));
    const fri20 = dayOf(d, new Date(2026, 10, 20));
    expect(d.schoolDays!['2026-11-13']).toBeDefined();
    expect(fri13.lessons).toEqual(d.schoolDays!['2026-11-13']);
    expect(fri20.lessons.map((l) => l.lessonNumber)).toEqual(
      d.lessons.filter((l) => l.weekday === 5).map((l) => l.lessonNumber),
    );
    expect(fri13.lessons).not.toEqual(fri20.lessons);
  });

  it('следующий учебный день учитывает замены, в которых уроков нет', () => {
    const d = applySchool(personal, fetched(), link, id('Петрова'), NOW);
    const onlyMon = {
      ...d,
      lessons: d.lessons.filter((l) => l.weekday === 1),
      schoolDays: { '2026-11-13': d.lessons.slice(0, 1) },
    };
    expect(getNextSchoolDay(onlyMon, NOW)!.getDate()).toBe(13);
    expect(
      getNextSchoolDay(
        { ...onlyMon, schoolDays: { '2026-11-16': [] } },
        new Date(2026, 10, 14),
      )!.getDate(),
    ).toBe(23);
  });

  it('классный руководитель получает «Мой класс» из школы', () => {
    const cls = base.classes.find((c) => c.name === '8б')!;
    const kuz = id('Кузнецов');
    const pub = nextPublication(
      p2,
      { kind: 'base', validFrom: '2026-11-09', schedule: base },
      { ...opt, homerooms: { [cls.id]: kuz } },
    );
    const d = applySchool(personal, fetched(pub, 3), link, kuz, NOW);
    expect(d.homeroom).toMatchObject({ enabled: true, className: '8б' });
    expect(d.homeroom!.lessons.length).toBeGreaterThan(20);
    expect(d.homeroom!.lessons.every((l) => l.subject && l.weekday >= 1 && l.weekday <= 5)).toBe(
      true,
    );
    expect(d.school!.homeroomClass).toBe('8б');
  });

  it('отключение возвращает личное расписание', () => {
    const d = applySchool(personal, fetched(), link, id('Петрова'), NOW);
    const again = applySchool(d, fetched(), link, id('Зайцева'), NOW); // сменили учителя — личное не теряется
    const back = disconnectSchool(again);
    expect(back.lessons).toEqual(personal.lessons);
    expect(back.bells).toEqual(personal.bells);
    expect(back.school).toBeUndefined();
    expect(back.schoolDays).toBeUndefined();
  });

  it('проверка обновлений: новая версия, новый день, пересозданный учитель', async () => {
    const d = applySchool(personal, fetched(), link, id('Петрова'), NOW);
    const api = (version: number, pub = p2) => ({
      meta: async () => ({ version, publishedAt: 'x' }),
      fetch: async () => fetched(pub, version),
    });
    expect((await checkSchool(d, NOW, api(2) as never)).kind).toBe('none');
    expect((await checkSchool(d, NOW, api(3) as never)).kind).toBe('update');
    expect((await checkSchool(d, new Date(2026, 10, 13, 8), api(2) as never)).kind).toBe('update'); // новый день
    // учитель пересоздан: другой id, то же имя
    const renamed = {
      ...base,
      teachers: base.teachers.map((t) => (t.id === id('Петрова') ? { ...t, id: '*tNEW' } : t)),
      entries: base.entries.map((e) => ({
        ...e,
        teachers: e.teachers.map((t) => (t === id('Петрова') ? '*tNEW' : t)),
      })),
    };
    const pub = nextPublication(
      null,
      { kind: 'base', validFrom: '2026-11-09', schedule: renamed },
      opt,
    );
    const r = await checkSchool(d, NOW, api(3, pub) as never);
    expect(r).toMatchObject({ kind: 'update', teacherId: '*tNEW' });
    const offline = { meta: async () => Promise.reject(new Error('Нет связи с сервером')) };
    expect(await checkSchool(d, NOW, offline as never)).toEqual({
      kind: 'error',
      message: 'Нет связи с сервером',
    });
  });

  it('без школы ничего не проверяется', async () => {
    expect((await checkSchool(personal, NOW)).kind).toBe('none');
  });
});

describe('сеть в настоящем приложении', () => {
  it('сервер школы разрешён в CSP Tauri — иначе на Windows и Android запрос заблокируется', async () => {
    const { DEFAULT_SERVER } = await import('./school/link');
    const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
    const csp: string = conf.app.security.csp;
    const connect = csp.split(';').find((p) => p.trim().startsWith('connect-src'))!;
    expect(connect.split(/\s+/)).toContain(new URL(DEFAULT_SERVER).origin);
  });
});
