// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyData } from './domain';
import { parseAscXml } from './school/asc';
import { nextPublication } from './school/publication';
import { applySchool } from './schoolMode';
import { applyWithChanges, notificationText, quietHours, shortDate } from './schoolChanges';

const base = parseAscXml(readFileSync('src/school/samples/demo-asc.xml', 'utf8'));
const changed = parseAscXml(readFileSync('src/school/samples/demo-asc-zameny.xml', 'utf8'));
const school = { id: 'abcd1234efgh5678', name: 'Демо' };
const link = { server: 'https://x', school: school.id, key: 'k' };
const id = (p: string) => base.teachers.find((t) => t.name.startsWith(p))!.id;
const cls5a = base.classes.find((c) => c.name === '5а')!;
const opt = { school, today: '2026-11-12', homerooms: { [cls5a.id]: id('Зайцева') } };
const p1 = nextPublication(null, { kind: 'base', validFrom: '2026-11-09', schedule: base }, opt);
const p2 = nextPublication(p1, { kind: 'override', date: '2026-11-13', schedule: changed }, opt);
const f = (publication = p1, version = 1) => ({ version, publishedAt: 'x', publication });
const DAY = new Date(2026, 10, 12, 10, 0);

describe('изменения от завуча', () => {
  it('первое подключение — без плашки', () => {
    const r = applyWithChanges(emptyData(), f(), link, id('Петрова'), DAY);
    expect(r.fresh).toBeNull();
    expect(r.data.school!.changes).toBeUndefined();
  });

  it('замены на 13-е: только свои уроки, с понятным текстом', () => {
    const d1 = applySchool(emptyData(), f(), link, id('Петрова'), DAY);
    const r = applyWithChanges(d1, f(p2, 2), link, id('Петрова'), DAY);
    expect(r.fresh).not.toBeNull();
    expect(r.fresh!.items.every((x) => x.date === '2026-11-13')).toBe(true);
    expect(r.fresh!.items.map((x) => x.kind)).toContain('отмена');
    expect(r.fresh!.items[0].text).toMatch(/^пт, 13 ноября, \d урок: /);
    expect(r.data.school!.changes!.items).toEqual(r.fresh!.items);
  });

  it('учитель, которого замены не касаются, ничего не получает', () => {
    const untouched = base.teachers.find(
      (t) =>
        !p2.overrides[0].entries.some((e) => e.teachers.includes(t.id)) &&
        base.entries.every((e) => e.day !== 5 || !e.teachers.includes(t.id)),
    )!;
    const d1 = applySchool(emptyData(), f(), link, untouched.id, DAY);
    expect(applyWithChanges(d1, f(p2, 2), link, untouched.id, DAY).fresh).toBeNull();
  });

  it('классному руководителю — дата изменения расписания класса', () => {
    const d1 = applySchool(emptyData(), f(), link, id('Зайцева'), DAY);
    const r = applyWithChanges(d1, f(p2, 2), link, id('Зайцева'), DAY);
    expect(r.fresh!.classDates).toEqual(['2026-11-13']);
    const n = notificationText(r.fresh!, '5а');
    expect(n.text).toContain('У 5а изменилось расписание: пт, 13 ноября');
  });

  it('непросмотренные копятся; та же версия ничего не добавляет; смена учителя — сброс', () => {
    const d1 = applySchool(emptyData(), f(), link, id('Петрова'), DAY);
    const d2 = applyWithChanges(d1, f(p2, 2), link, id('Петрова'), DAY).data;
    const same = applyWithChanges(d2, f(p2, 2), link, id('Петрова'), new Date(2026, 10, 13, 8));
    expect(same.fresh).toBeNull();
    expect(same.data.school!.changes).toEqual(d2.school!.changes); // плашка осталась
    const back = applyWithChanges(d2, f(p1, 3), link, id('Петрова'), DAY); // замену отменили
    expect(back.data.school!.changes!.items.length).toBe(d2.school!.changes!.items.length);
    const other = applyWithChanges(d2, f(p2, 2), link, id('Зайцева'), DAY);
    expect(other.data.school!.changes).toBeUndefined();
  });

  it('тихие часы 21:00–6:30: уведомление ждёт утра', () => {
    expect(quietHours(new Date(2026, 10, 12, 21, 0))).toBe(true);
    expect(quietHours(new Date(2026, 10, 13, 6, 29))).toBe(true);
    expect(quietHours(new Date(2026, 10, 13, 6, 30))).toBe(false);
    const d1 = applySchool(emptyData(), f(), link, id('Петрова'), DAY);
    const night = applyWithChanges(
      d1,
      f(p2, 2),
      link,
      id('Петрова'),
      new Date(2026, 10, 12, 22, 0),
    );
    expect(night.fresh!.notifyPending).toBe(true);
    expect(applyWithChanges(d1, f(p2, 2), link, id('Петрова'), DAY).fresh!.notifyPending).toBe(
      false,
    );
  });

  it('текст уведомления: до четырёх строк и «ещё N»', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      date: '2026-11-13',
      lessonNumber: i + 1,
      kind: 'замена' as const,
      text: `строка ${i + 1}`,
    }));
    const n = notificationText({ items, classDates: [] }, '');
    expect(n.title).toBe('Завуч изменил ваше расписание');
    expect(n.text.split('\n')).toEqual(['строка 1', 'строка 2', 'строка 3', 'строка 4', 'и ещё 2']);
    expect(shortDate('2026-11-16')).toBe('пн, 16 ноября');
  });
});
