/**
 * Названия для бланков: завуч может поправить название предмета или кабинета здесь,
 * не трогая aSc (опечатки, слишком длинные названия для учеников).
 * Ключ — название как в aSc, значение — как показывать.
 */
import type { Schedule } from './model';

export type NameMap = Record<string, string>;

const cache = new WeakMap<Schedule, { key: string; out: Schedule }>();

export function withNames(s: Schedule, names: NameMap): Schedule {
  const key = JSON.stringify(names);
  const hit = cache.get(s);
  if (hit && hit.key === key) return hit.out;
  const pick = (v: string) => (names[v]?.trim() ? names[v].trim() : v);
  const out = Object.keys(names).length
    ? {
        ...s,
        subjects: s.subjects.map((x) => ({ ...x, name: pick(x.name), short: pick(x.short) })),
        rooms: s.rooms.map((r) => ({ ...r, name: pick(r.name), short: pick(r.short) })),
      }
    : s;
  cache.set(s, { key, out });
  return out;
}
