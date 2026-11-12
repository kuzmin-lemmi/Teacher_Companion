// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseAscXml } from './asc';
import { decryptJson, encryptJson, generateSchoolKey } from './crypto';
import { diffDay } from './diff';
import {
  assertPublication,
  baseFor,
  homeroomClasses,
  nextPublication,
  scheduleForDate,
  type Publication,
} from './publication';

const base = parseAscXml(readFileSync('src/school/samples/demo-asc.xml', 'utf8'), 'основное');
const changed = parseAscXml(
  readFileSync('src/school/samples/demo-asc-zameny.xml', 'utf8'),
  'замены',
);
const school = { id: 'abcd1234efgh5678', name: 'Демо-школа' };
const FRI = '2026-11-13';
const NEXT_FRI = '2026-11-20';

describe('публикация tc-school/2', () => {
  const first = nextPublication(
    null,
    { kind: 'base', validFrom: '2026-11-09', schedule: base },
    { school, today: '2026-11-12' },
  );

  it('основа: служебные заметки разбора не уходят учителям', () => {
    assertPublication(first);
    expect(first.bases).toHaveLength(1);
    expect(first.bases[0].schedule.notes).toBeUndefined();
    expect(first.overrides).toEqual([]);
  });

  it('замена действует только в свою дату, не во все пятницы', () => {
    const pub = nextPublication(
      first,
      { kind: 'override', date: FRI, schedule: changed },
      { school, today: '2026-11-12' },
    );
    expect(pub.overrides.map((o) => o.date)).toEqual([FRI]);
    const fri = scheduleForDate(pub, FRI)!;
    const nextFri = scheduleForDate(pub, NEXT_FRI)!;
    expect(diffDay(changed, fri, 5)).toEqual([]); // 13-го — как в выгрузке с заменами
    expect(diffDay(base, nextFri, 5)).toEqual([]); // 20-го — снова основное
    expect(diffDay(base, fri, 4)).toEqual([]); // другие дни недели не тронуты
  });

  it('замена, совпавшая с основой, снимается', () => {
    const pub = nextPublication(
      first,
      { kind: 'override', date: FRI, schedule: changed },
      { school, today: '2026-11-12' },
    );
    const undone = nextPublication(
      pub,
      { kind: 'override', date: FRI, schedule: base },
      { school, today: '2026-11-12' },
    );
    expect(undone.overrides).toEqual([]);
  });

  it('новое основное с будущей даты: до неё — прежнее, замены после неё сбрасываются', () => {
    const withOverride = nextPublication(
      first,
      { kind: 'override', date: NEXT_FRI, schedule: changed },
      { school, today: '2026-11-12' },
    );
    const pub = nextPublication(
      withOverride,
      { kind: 'base', validFrom: '2026-11-16', schedule: changed },
      { school, today: '2026-11-12' },
    );
    expect(pub.bases.map((b) => b.validFrom)).toEqual(['2026-11-09', '2026-11-16']);
    expect(baseFor(pub, FRI)!.validFrom).toBe('2026-11-09');
    expect(baseFor(pub, NEXT_FRI)!.validFrom).toBe('2026-11-16');
    expect(pub.overrides).toEqual([]);
    // а когда новое основное уже началось, прежнее не нужно
    const later = nextPublication(
      pub,
      { kind: 'base', validFrom: '2026-11-16', schedule: changed },
      { school, today: '2026-11-17' },
    );
    expect(later.bases.map((b) => b.validFrom)).toEqual(['2026-11-16']);
  });

  it('старые замены удаляются через неделю', () => {
    const pub = nextPublication(
      first,
      { kind: 'override', date: '2026-11-06', schedule: changed },
      { school, today: '2026-11-07' },
    );
    expect(pub.overrides).toHaveLength(1);
    const later = nextPublication(
      pub,
      { kind: 'override', date: FRI, schedule: changed },
      { school, today: '2026-11-14' },
    );
    expect(later.overrides.map((o) => o.date)).toEqual([FRI]);
  });

  it('новый учитель на замене попадает в справочник дня', () => {
    const extraTeacher = { id: '*tNEW', name: 'Новикова Н.', short: 'Новикова' };
    const fri = changed.entries.find((e) => e.day === 5)!;
    const withNew = {
      ...changed,
      teachers: [...changed.teachers, extraTeacher],
      entries: changed.entries.map((e) => (e === fri ? { ...e, teachers: ['*tNEW'] } : e)),
    };
    const pub = nextPublication(
      first,
      { kind: 'override', date: FRI, schedule: withNew },
      { school, today: '2026-11-12' },
    );
    expect(pub.overrides[0].extra?.teachers).toEqual([extraTeacher]);
    expect(scheduleForDate(pub, FRI)!.teachers.some((t) => t.id === '*tNEW')).toBe(true);
    expect(scheduleForDate(pub, NEXT_FRI)!.teachers.some((t) => t.id === '*tNEW')).toBe(false);
  });

  it('классное руководство из «Бланков» главнее aSc', () => {
    const cls = base.classes.find((c) => c.name === '8б')!;
    const teacher = base.teachers.find((t) => t.name.startsWith('Кузнецов'))!;
    const pub = nextPublication(
      first,
      { kind: 'base', validFrom: '2026-11-09', schedule: base },
      { school, today: '2026-11-12', homerooms: { [cls.id]: teacher.id } },
    );
    expect(homeroomClasses(pub, teacher.id, FRI).map((c) => c.name)).toContain('8б');
  });

  it('публикация целиком: шифруется, расшифровывается и проверяется', async () => {
    const key = generateSchoolKey();
    const pub = nextPublication(
      first,
      { kind: 'override', date: FRI, schedule: changed },
      { school, today: '2026-11-12' },
    );
    const blob = await encryptJson(pub, key, school.id);
    expect(blob.length).toBeLessThan(200_000);
    const back = await decryptJson<Publication>(blob, key, school.id);
    assertPublication(back);
    expect(back).toEqual(pub);
    expect(() => assertPublication({ format: 'tc-school/9' })).toThrow('обновите приложение');
  });
});
