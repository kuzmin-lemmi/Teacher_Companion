import { describe, expect, it } from 'vitest';
import { getChecklistStats, hasChecklist, parseChecklist, toggleChecklistItem } from './checklist';

describe('checklist', () => {
  it('detects checkboxes', () => {
    expect(hasChecklist('[ ] тетради')).toBe(true);
    expect(hasChecklist('[X] готово')).toBe(true);
    expect(hasChecklist('обычная заметка')).toBe(false);
    expect(hasChecklist('')).toBe(false);
  });

  it('parses text and items in order', () => {
    expect(parseChecklist('Контрольная [ ] Раздать тетради [x] Проверить ДЗ')).toEqual([
      { kind: 'text', text: 'Контрольная' },
      { kind: 'item', index: 0, done: false, text: 'Раздать тетради' },
      { kind: 'item', index: 1, done: true, text: 'Проверить ДЗ' },
    ]);
    expect(parseChecklist('')).toEqual([]);
    expect(parseChecklist('[ ]')).toEqual([
      { kind: 'item', index: 0, done: false, text: 'Без названия' },
    ]);
  });

  it('toggles only the requested item', () => {
    const note = '[ ] a [x] b [ ] c';
    expect(toggleChecklistItem(note, 0)).toBe('[x] a [x] b [ ] c');
    expect(toggleChecklistItem(note, 1)).toBe('[ ] a [ ] b [ ] c');
    expect(toggleChecklistItem(note, 5)).toBe(note);
  });

  it('counts total and done items', () => {
    expect(getChecklistStats('[ ] a [x] b [X] c')).toEqual({ total: 3, done: 2 });
    expect(getChecklistStats('без задач')).toEqual({ total: 0, done: 0 });
  });
});
