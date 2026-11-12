// @vitest-environment jsdom
/**
 * Независимая сверка разбора с настоящей выгрузкой aSc. Без файла тест пропускается.
 *
 *   SCHOOL_XML=../1.xml npx vitest run blanki/verify
 *   SCHOOL_XML=../1.xml SCHOOL_DAY_SHEET=../friday.txt SCHOOL_DAY=5 npx vitest run blanki/verify
 *
 * 1. Каждая карточка XML читается здесь отдельно, регулярками, без кода разбора приложения,
 *    и должна ровно один раз попасть в расписание (день, урок, класс, группа, предмет, учитель, кабинет).
 * 2. Фантомов (уроков, которых нет в XML) и задвоений быть не должно.
 * 3. Если дана расшифровка бумажной распечатки дня («Фамилия: 9в 11а - - …») — сверка учителей урок за уроком.
 *
 * Настоящие выгрузки с ФИО коллег в репозиторий не кладутся.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeXml, parseAscXml } from '../src/school/asc';
import { checkSchedule } from '../src/school/checks';
import { lookup } from '../src/school/model';
import { teacherRows } from '../src/school/views';

const file = process.env.SCHOOL_XML;

if (!file || !existsSync(file))
  describe.skip('сверка с настоящей выгрузкой aSc', () =>
    it('нужен SCHOOL_XML=путь/к/выгрузке.xml', () => {}));
else
  describe('сверка с настоящей выгрузкой aSc', () => {
    const xml = decodeXml(new Uint8Array(readFileSync(file)));
    const s = parseAscXml(xml, file);
    const L = lookup(s);
    const attrs = (t: string) =>
      Object.fromEntries([...t.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const all = (tag: string) =>
      [...xml.matchAll(new RegExp(`<${tag} ([^>]*)/>`, 'g'))].map((m) => attrs(m[1]));
    const byId = (tag: string) => new Map(all(tag).map((r) => [r.id, r]));
    const lessons = byId('lesson');
    const subjects = byId('subject');
    const teachers = byId('teacher');
    const classes = byId('class');
    const rooms = byId('classroom');
    const groups = byId('group');
    const list = (v = '') => v.split(',').filter(Boolean);
    const key = (...p: (string | number)[]) => p.join('|');

    it('каждая карточка — ровно один урок, без фантомов и задвоений', () => {
      const raw = new Map<string, number>();
      for (const c of all('card')) {
        const l = lessons.get(c.lessonid)!;
        const g = list(l.groupids).map((id) => groups.get(id)!);
        const group = g.some((x) => x.entireclass === '1') ? '' : g.map((x) => x.name).join(', ');
        for (const cl of list(l.classids))
          for (const t of list(l.teacherids)) {
            const k = key(
              c.days.indexOf('1') + 1,
              Number(c.period),
              classes.get(cl)!.short || classes.get(cl)!.name,
              group,
              subjects.get(l.subjectid)!.name,
              t,
              list(c.classroomids)
                .map((r) => rooms.get(r)!.short)
                .join(','),
            );
            raw.set(k, (raw.get(k) ?? 0) + 1);
          }
      }
      const got = new Map<string, number>();
      for (const e of s.entries)
        for (const cl of e.classes)
          for (const t of e.teachers) {
            const k = key(
              e.day,
              e.lesson,
              L.cls(cl)!.name,
              e.group ?? '',
              L.subject(e.subject)!.name,
              t,
              e.rooms.map((r) => L.room(r)!.short).join(','),
            );
            got.set(k, (got.get(k) ?? 0) + 1);
          }
      const human = (k: string) => {
        const [d, n, cls, g, subj, t, room] = k.split('|');
        return `${s.days[+d - 1]?.short} ${n} урок, ${cls}${g ? ` (${g})` : ''} ${subj}, ${teachers.get(t)?.lastname ?? t}, каб ${room || '—'}`;
      };
      expect([...raw.keys()].filter((k) => !got.has(k)).map(human), 'потеряно').toEqual([]);
      expect([...got.keys()].filter((k) => !raw.has(k)).map(human), 'фантомы').toEqual([]);
      expect(
        [...got].filter(([, n]) => n > 1).map(([k]) => human(k)),
        'задвоено',
      ).toEqual([]);
      expect(s.notes!.cards + s.notes!.synthesized).toBe(s.entries.length);
    });

    const sheet = process.env.SCHOOL_DAY_SHEET;
    it.runIf(sheet && existsSync(sheet))('совпадает с бумажной распечаткой дня', () => {
      const day = Number(process.env.SCHOOL_DAY ?? 5);
      const rows = teacherRows(s, day);
      const diffs: string[] = [];
      for (const line of readFileSync(sheet!, 'utf8').split('\n')) {
        const m = /^([^#:]+):\s*(.+)$/.exec(line.trim());
        if (!m) continue;
        const name = m[1].trim();
        const want = m[2]
          .trim()
          .split(/\s+/)
          .map((x) => (x === '-' ? '' : x.toLowerCase()));
        const row = rows.find(
          (r) =>
            r.teacher.short.replace(/^\S+\s+/, '') === name ||
            r.teacher.name.startsWith(name + ' '),
        );
        if (!row && want.some(Boolean)) diffs.push(`${name}: нет в расписании`);
        want.forEach((w, i) => {
          const have = (row?.cells.get(i + 1)?.classes ?? '').toLowerCase();
          if (w !== have)
            diffs.push(
              `${name}, ${i + 1} урок: распечатка «${w || '—'}», расписание «${have || '—'}»`,
            );
        });
      }
      expect(diffs).toEqual([]);
    });

    it('отчёт проверки (для чтения глазами)', () => {
      for (const i of checkSchedule(s)) console.log(`[${i.level}] ${i.title} — ${i.items.length}`);
    });
  });
