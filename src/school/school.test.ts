// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeXml, parseAscXml } from './asc';
import { changedTeacherCells, diffDay } from './diff';
import { classDayText } from './text';
import { classRows, lessonColumns, teacherRows } from './views';
import { dateLabel, nextSchoolDay, weekdayOf } from './dates';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<timetable ascttversion="2012">
  <periods>
    <period period="1" name="1" short="1" starttime="8:30" endtime="9:15"/>
    <period period="2" name="2" short="2" starttime="9:25" endtime="10:10"/>
    <period period="3" name="3" short="3" starttime="10:30" endtime="11:15"/>
  </periods>
  <daysdefs>
    <daysdef id="*1" name="Любой день" short="X" days="10000,01000,00100,00010,00001"/>
    <daysdef id="*2" name="Понедельник" short="Пн" days="10000"/>
  </daysdefs>
  <subjects>
    <subject id="s1" name="Математика" short="Мат"/>
    <subject id="s2" name="Английский язык" short="Англ"/>
    <subject id="s3" name="Физическая культура" short="Фк"/>
  </subjects>
  <teachers>
    <teacher id="t1" firstname="Анна Петровна" lastname="Иванова" short="ИвАП"/>
    <teacher id="t2" firstname="Ольга" lastname="Смирнова" short="СмО"/>
    <teacher id="t3" firstname="Борис Ильич" lastname="Котов" short="КоБИ"/>
    <teacher id="t4" name="Петров П." short="ПП"/>
  </teachers>
  <classrooms>
    <classroom id="r1" name="Кабинет 12" short="12"/>
    <classroom id="r2" name="Кабинет 14" short="14"/>
    <classroom id="r3" name="Спортзал" short="с/з"/>
  </classrooms>
  <classes>
    <class id="c1" name="5 А" short="5а" grade="5" teacherid="t1"/>
    <class id="c2" name="5 Б" short="5б" grade="5"/>
    <class id="c3" name="10 А" short="10а" grade="10"/>
  </classes>
  <groups>
    <group id="g0" classid="c1" name="Весь класс" entireclass="1"/>
    <group id="g1" classid="c1" name="1 группа" entireclass="0"/>
    <group id="g2" classid="c1" name="2 группа" entireclass="0"/>
  </groups>
  <lessons>
    <lesson id="L1" classids="c1" groupids="g0" subjectid="s1" teacherids="t1" classroomids="r1" periodspercard="2"/>
    <lesson id="L2" classids="c1" groupids="g1" subjectid="s2" teacherids="t2" classroomids="r2" periodspercard="1"/>
    <lesson id="L3" classids="c1" groupids="g2" subjectid="s2" teacherids="t3" classroomids="" periodspercard="1"/>
    <lesson id="L4" classids="c1,c2" subjectid="s3" teacherids="t4" classroomids="r3" periodspercard="1"/>
    <lesson id="L5" classids="c3" subjectid="s1" teacherids="t1" classroomids="r1" periodspercard="1"/>
  </lessons>
  <cards>
    <card lessonid="L1" period="1" days="10000" weeks="1" classroomids="r1"/>
    <card lessonid="L2" period="3" days="10000" weeks="1" classroomids="r2"/>
    <card lessonid="L3" period="3" days="10000" weeks="1" classroomids=""/>
    <card lessonid="L4" period="1" days="01000" weeks="1" classroomids=""/>
    <card lessonid="L5" period="3" days="01000" weeks="10" classroomids="r1"/>
  </cards>
</timetable>`;

describe('разбор aSc XML', () => {
  const s = parseAscXml(XML, 'test.xml');

  it('справочники и дни', () => {
    expect(s.format).toBe('tc-school/1');
    expect(s.days.map((d) => d.short)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт']);
    expect(s.bells[0]).toEqual({ lesson: 1, label: '1', start: '08:30', end: '09:15' });
    expect(s.teachers.map((t) => t.name)).toEqual([
      'Иванова А. П.',
      'Смирнова О.',
      'Котов Б. И.',
      'Петров П.',
    ]);
    expect(s.classes.map((c) => c.name)).toEqual(['5а', '5б', '10а']);
    expect(s.classes[0].teacher).toBe('t1');
  });

  it('сдвоенный урок, группы, объединённые классы, недели', () => {
    const mon = s.entries.filter((e) => e.day === 1);
    expect(mon.map((e) => e.lesson)).toEqual([1, 2, 3, 3]);
    expect(mon.filter((e) => e.lesson === 3).map((e) => e.group)).toEqual(['1 группа', '2 группа']);
    const pe = s.entries.find((e) => e.subject === 's3')!;
    expect(pe.classes).toEqual(['c1', 'c2']);
    expect(pe.rooms).toEqual(['r3']); // в карточке пусто — единственный кабинет урока
    expect(s.entries.find((e) => e.classes[0] === 'c3')!.weeks).toBe('10');
    expect(s.warnings).toContain('У 1 уроков не указан кабинет.');
  });

  it('учителя × уроки', () => {
    const rows = teacherRows(s, 1);
    const iv = rows.find((r) => r.teacher.id === 't1')!;
    expect(iv.subject).toBe('Мат');
    expect(iv.cells.get(1)).toEqual({ classes: '5а', rooms: '12', subjects: 'Мат' });
    expect(iv.cells.get(2)?.classes).toBe('5а');
    expect(
      teacherRows(s, 2)
        .find((r) => r.teacher.id === 't4')!
        .cells.get(1)?.classes,
    ).toBe('5а, 5б');
    expect(lessonColumns(s)).toEqual([1, 2, 3]);
  });

  it('классы × уроки по порядку', () => {
    expect(classRows(s, 1).map((r) => r.cls.name)).toEqual(['5а', '5б', '10а']);
    expect(classRows(s, 1)[0].cells.get(3)?.length).toBe(2);
  });

  it('текст для чата', () => {
    expect(
      classDayText(s, 'c1', 1, 'понедельник, 16 ноября', { rooms: false, teachers: false }),
    ).toBe(
      [
        '📅 5а — понедельник, 16 ноября',
        '',
        '1. 08:30–09:15 Математика',
        '2. 09:25–10:10 Математика',
        '3. 10:30–11:15 Английский язык (2 группы)',
        '',
        '🔔 Уроки заканчиваются в 11:15',
      ].join('\n'),
    );
    expect(classDayText(s, 'c1', 2, 'вторник', { rooms: true, teachers: false })).toContain(
      '1. 08:30–09:15 Физическая культура, с/з',
    );
    expect(classDayText(s, 'c1', 1, 'понедельник', { rooms: true, teachers: false })).toContain(
      '1. 08:30–09:15 Математика, каб. 12',
    );
    expect(classDayText(s, 'c2', 1, 'понедельник', { rooms: false, teachers: false })).toContain(
      'Уроков нет',
    );
  });

  it('лист замен', () => {
    const changed = parseAscXml(
      XML.replace('<card lessonid="L2" period="3" days="10000" weeks="1" classroomids="r2"/>', '')
        .replace(
          'lessonid="L1" period="1" days="10000" weeks="1" classroomids="r1"',
          'lessonid="L1" period="1" days="10000" weeks="1" classroomids="r2"',
        )
        .replace('teacherids="t4"', 'teacherids="t3"'),
    );
    const mon = diffDay(s, changed, 1);
    expect(mon.map((c) => [c.className, c.lesson, c.kind])).toEqual([
      ['5а', 1, 'кабинет'],
      ['5а', 2, 'кабинет'],
      ['5а', 3, 'замена'],
    ]);
    const tue = diffDay(s, changed, 2);
    expect(tue.map((c) => [c.className, c.kind])).toEqual([
      ['5а', 'замена'],
      ['5б', 'замена'],
    ]);
    expect(tue[0].teachers).toEqual(['Котов Б. И.', 'Петров П.']);
    expect(changedTeacherCells(s, changed, 2)).toEqual(new Set(['Котов Б. И.|1', 'Петров П.|1']));
  });

  it('ошибки понятны', () => {
    expect(() => parseAscXml('<html></html>')).toThrow(/aSc/);
    expect(() => parseAscXml('не xml')).toThrow(/XML/);
  });
});

describe('кодировка', () => {
  it('windows-1251 из заголовка', () => {
    const head = new TextEncoder().encode('<?xml version="1.0" encoding="windows-1251"?><t a="');
    const bytes = new Uint8Array([...head, 0xcc, 0xe0, 0xf2, 0x22, 0x2f, 0x3e]);
    expect(decodeXml(bytes)).toContain('a="Мат"');
  });
});

describe('даты', () => {
  it('день недели и подпись', () => {
    expect(weekdayOf('2026-11-13')).toBe(5);
    expect(dateLabel('2026-11-13')).toBe('пятница, 13 ноября');
    expect(nextSchoolDay(new Date(2026, 10, 13), 5)).toBe('2026-11-16');
    expect(nextSchoolDay(new Date(2026, 10, 12), 5)).toBe('2026-11-13');
  });
});

describe('демо-школа', () => {
  it('разбирается и без накладок у учителей', () => {
    const text = readFileSync('src/school/samples/demo-asc.xml', 'utf8');
    const s = parseAscXml(text);
    expect(s.classes.length).toBeGreaterThan(10);
    const busy = new Set<string>();
    for (const e of s.entries)
      for (const t of e.teachers) {
        const k = `${t}|${e.day}|${e.lesson}`;
        expect(busy.has(k), k).toBe(false);
        busy.add(k);
      }
    const changed = parseAscXml(readFileSync('src/school/samples/demo-asc-zameny.xml', 'utf8'));
    expect(diffDay(s, changed, 5).length).toBeGreaterThan(3);
  });
});

describe('проверка расписания', async () => {
  const { checkSchedule, fixTypos } = await import('./checks');
  const { withNames } = await import('./names');
  const s = parseAscXml(XML);

  it('опечатки', () => {
    expect(fixTypos('Алебра')).toBe('Алгебра');
    expect(fixTypos('Избранные вопросы матемитики')).toBe('Избранные вопросы математики');
    expect(fixTypos('Анлг.яз')).toBe('Англ.яз');
    expect(fixTypos('ДНКР')).toBe('ДНКР');
    expect(fixTypos('Литература')).toBe('Литература');
  });

  it('накладки учителя и класса с подробностями', () => {
    const bad = parseAscXml(
      XML.replace(
        '<card lessonid="L5" period="3" days="01000"',
        '<card lessonid="L5" period="1" days="10000"',
      ),
    );
    const ids = checkSchedule(bad).map((i) => i.id);
    expect(ids).toContain('teacher-clash');
    expect(checkSchedule(bad).find((i) => i.id === 'teacher-clash')!.items[0]).toBe(
      'Иванова А. П.: понедельник, 1 урок — 5а Математика и 10а Математика [неделя 1 из 2]',
    );
    expect(checkSchedule(s).map((i) => i.id)).not.toContain('teacher-clash');
    const no = checkSchedule(s).find((i) => i.id === 'no-room')!;
    expect(no.items).toEqual(['Котов Б. И.: 1 урок (5а)']);
  });

  it('названия для бланков', () => {
    const n = withNames(s, { Математика: 'Матем.' });
    expect(n.subjects[0].name).toBe('Матем.');
    expect(withNames(s, { Математика: 'Матем.' })).toBe(n);
  });
});

describe('сдвоенные уроки', () => {
  it('aSc 2027: карточка на каждый урок пары — без лишнего третьего урока', () => {
    const xml = XML.replace(
      '<card lessonid="L1" period="1" days="10000" weeks="1" classroomids="r1"/>',
      '<card lessonid="L1" period="1" days="10000" weeks="1" classroomids="r1"/><card lessonid="L1" period="2" days="10000" weeks="1" classroomids="r1"/>',
    );
    const s = parseAscXml(xml);
    expect(s.entries.filter((e) => e.subject === 's1' && e.day === 1).map((e) => e.lesson)).toEqual(
      [1, 2],
    );
    expect(s.notes?.overflow).toEqual([]);
  });
});

describe('анализ XML: недели, деления, нагрузка', async () => {
  const { checkSchedule } = await import('./checks');
  const ids = (s: ReturnType<typeof parseAscXml>) => checkSchedule(s).map((i) => i.id);

  it('сверка: карточки + достроенные половины пар = уроки', () => {
    const s = parseAscXml(XML);
    expect(s.notes!.cards).toBe(5);
    expect(s.notes!.synthesized).toBe(1); // L1 — пара одной карточкой (старый формат)
    expect(s.notes!.cards + s.notes!.synthesized).toBe(s.entries.length);
  });

  it('урок по неделе А и урок по неделе Б в одной клетке — не накладка', () => {
    const xml = XML.replace(
      '<card lessonid="L5" period="3" days="01000" weeks="10"',
      '<card lessonid="L5" period="1" days="10000" weeks="10"',
    ).replace(
      '<card lessonid="L1" period="1" days="10000" weeks="1" classroomids="r1"/>',
      '<card lessonid="L1" period="1" days="10000" weeks="01" classroomids="r1"/><card lessonid="L1" period="2" days="10000" weeks="01" classroomids="r1"/>',
    );
    const s = parseAscXml(xml);
    expect(ids(s)).not.toContain('teacher-clash');
    expect(ids(s)).toContain('weeks');
  });

  it('группы разных делений в одной клетке — накладка', () => {
    const xml = XML.replace(
      '<group id="g2" classid="c1" name="2 группа" entireclass="0"/>',
      '<group id="g2" classid="c1" name="Мальчики" entireclass="0" divisiontag="2"/>',
    ).replace(
      '<group id="g1" classid="c1" name="1 группа" entireclass="0"/>',
      '<group id="g1" classid="c1" name="1 группа" entireclass="0" divisiontag="1"/>',
    );
    const issue = checkSchedule(parseAscXml(xml)).find((i) => i.id === 'class-clash');
    expect(issue?.items[0]).toContain('5а: понедельник, 3 урок');
    expect(ids(parseAscXml(XML))).not.toContain('class-clash');
  });

  it('поставлено меньше часов, чем в нагрузке', () => {
    const xml = XML.replace(
      'periodspercard="1"/>\n    <lesson id="L5"',
      'periodspercard="1" periodsperweek="3"/>\n    <lesson id="L5"',
    );
    const issue = checkSchedule(parseAscXml(xml)).find((i) => i.id === 'partial');
    expect(issue?.items).toEqual([
      '5а, 5б — Физическая культура (Петров П.): по нагрузке 3 ч. в неделю, поставлено 1',
    ]);
  });
});
