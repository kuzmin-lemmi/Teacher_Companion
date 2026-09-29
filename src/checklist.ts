/**
 * Поддержка мини-задач (чек-листов) в заметках к урокам.
 * Формат в тексте заметки: `[ ] Задача` (не выполнена) и `[x] Задача` (выполнена).
 */

export type ChecklistPart =
  { kind: 'text'; text: string } | { kind: 'item'; index: number; done: boolean; text: string };

const CHECKBOX_REGEX = /\[([ xX])\]/g;

/** Есть ли в заметке хотя бы один чек-бокс */
export function hasChecklist(note: string): boolean {
  return /\[([ xX])\]/.test(note);
}

/**
 * Разбирает текст заметки на части (обычный текст и элементы чек-листа).
 */
export function parseChecklist(note: string): ChecklistPart[] {
  if (!note) return [];
  const parts: ChecklistPart[] = [];
  const regex = /\[([ xX])\]\s*([^[\n]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let itemIndex = 0;

  while ((match = regex.exec(note)) !== null) {
    if (match.index > lastIndex) {
      const prefix = note
        .slice(lastIndex, match.index)
        .trim()
        .replace(/[,;]+$/, '')
        .trim();
      if (prefix) {
        parts.push({ kind: 'text', text: prefix });
      }
    }
    const done = match[1].toLowerCase() === 'x';
    const text = match[2]
      .trim()
      .replace(/[,;]+$/, '')
      .trim();
    parts.push({
      kind: 'item',
      index: itemIndex++,
      done,
      text: text || 'Без названия',
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < note.length) {
    const suffix = note
      .slice(lastIndex)
      .trim()
      .replace(/^[,;]+/, '')
      .trim();
    if (suffix) {
      parts.push({ kind: 'text', text: suffix });
    }
  }

  return parts;
}

/**
 * Переключает состояние n-го чекбокса ([ ] <-> [x]) в строке заметки.
 */
export function toggleChecklistItem(note: string, targetIndex: number): string {
  let currentIndex = 0;
  return note.replace(CHECKBOX_REGEX, (match, char) => {
    if (currentIndex++ === targetIndex) {
      const isDone = char.toLowerCase() === 'x';
      return isDone ? '[ ]' : '[x]';
    }
    return match;
  });
}

/**
 * Подсчитывает общее количество задач и сколько из них выполнено.
 */
export function getChecklistStats(note: string): { total: number; done: number } {
  let total = 0;
  let done = 0;
  const matches = note.matchAll(CHECKBOX_REGEX);
  for (const m of matches) {
    total++;
    if (m[1].toLowerCase() === 'x') done++;
  }
  return { total, done };
}
