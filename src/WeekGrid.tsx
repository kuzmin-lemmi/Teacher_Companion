import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from './icons';
import { lessonColor, weekdays, type AppData, type Lesson } from './domain';

const shortDay = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
const ROWS = 12;
type Cell = { d: number; n: number };
const key = ({ d, n }: Cell) => `${d}-${n}`;
const unique = (values: string[]) =>
  [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true }),
  );

/**
 * Неделя целиком, заполняется прямо в клетках, как таблица.
 * Нажатие на клетку открывает поля урока; Enter — урок ниже, Tab — тот же урок в следующий день,
 * Esc — готово. Стрелки ходят по клеткам, Delete удаляет, Ctrl+C / Ctrl+V копируют,
 * перетаскивание переносит урок (с Ctrl — копирует).
 */
export function WeekGrid({
  data,
  change,
  defaults,
  onOpenDay,
  onStatus,
}: {
  data: AppData;
  change: (next: AppData) => void;
  defaults: { subject: string; room: string };
  /** Индивидуальное время и прочие подробности — в режиме «День». */
  onOpenDay: (weekday: number, id: string) => void;
  onStatus: (text: string) => void;
}) {
  const [sel, setSel] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [clip, setClip] = useState<Lesson | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: Cell | null; copy: boolean } | null>(null);
  // Урок, созданный этим вводом: если класс так и не ввели, он исчезает при выходе из клетки.
  const created = useRef<string | null>(null);
  // Актуальный редактируемый урок: blur старой клетки не должен затирать уже сделанный переход.
  const editingRef = useRef<string | null>(null);
  const pendingFocus = useRef<{ cell: Cell; field?: 'class' } | null>(null);
  const press = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const table = useRef<HTMLTableElement>(null);

  const last = Math.max(
    6,
    ...data.lessons.map((l) => l.lessonNumber),
    ...data.bells.map((b) => b.lessonNumber),
  );
  const rows = Math.min(last, ROWS);
  const numbers = Array.from({ length: rows }, (_, i) => i + 1);
  const at = ({ d, n }: Cell) => data.lessons.find((l) => l.weekday === d && l.lessonNumber === n);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const td = table.current?.querySelector<HTMLElement>(`[data-cell="${key(target.cell)}"]`);
    const el = target.field
      ? td?.querySelector<HTMLInputElement>('input[data-field="class"]')
      : td?.querySelector<HTMLButtonElement>('button.ed-cell');
    if (!el) return;
    pendingFocus.current = null;
    el.focus();
    if (el instanceof HTMLInputElement) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  });

  /** Без брошенного пустого урока: класс — обязательное поле. */
  function withoutAbandoned(lessons: Lesson[]) {
    const id = created.current;
    created.current = null;
    if (!id) return lessons;
    const lesson = lessons.find((l) => l.id === id);
    return lesson && !lesson.className.trim() ? lessons.filter((l) => l.id !== id) : lessons;
  }

  /** Закрывает текущую клетку и открывает поля в cell (создаёт урок, если клетка пуста). */
  function editAt(cell: Cell, className?: string) {
    let lessons = withoutAbandoned(data.lessons);
    let lesson = lessons.find((l) => l.weekday === cell.d && l.lessonNumber === cell.n);
    if (!lesson) {
      lesson = {
        id: crypto.randomUUID(),
        weekday: cell.d,
        lessonNumber: cell.n,
        className: className ?? '',
        subject: defaults.subject,
        room: defaults.room,
      };
      lessons = [...lessons, lesson];
      created.current = lesson.id;
    } else if (className !== undefined) {
      const id = lesson.id;
      lessons = lessons.map((l) => (l.id === id ? { ...l, className } : l));
    }
    editingRef.current = lesson.id;
    if (lessons !== data.lessons) change({ ...data, lessons });
    setSel(cell);
    setEditing(lesson.id);
    pendingFocus.current = { cell, field: 'class' };
  }

  function stopEditing(focusCell = true) {
    const lessons = withoutAbandoned(data.lessons);
    editingRef.current = null;
    if (lessons !== data.lessons) change({ ...data, lessons });
    setEditing(null);
    if (focusCell && sel) pendingFocus.current = { cell: sel };
  }

  function select(cell: Cell) {
    setSel(cell);
    pendingFocus.current = { cell };
  }

  function update(id: string, patch: Partial<Lesson>) {
    change({ ...data, lessons: data.lessons.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }

  function remove(cell: Cell) {
    const lesson = at(cell);
    if (!lesson) return;
    change({ ...data, lessons: data.lessons.filter((l) => l.id !== lesson.id) });
    onStatus(`Удалён урок: ${lesson.className || '—'}, ${weekdays[cell.d - 1].toLowerCase()}`);
  }

  /** Кладёт копию урока в клетку: что там было — заменяется. */
  function put(source: Lesson, cell: Cell) {
    const rest = data.lessons.filter((l) => !(l.weekday === cell.d && l.lessonNumber === cell.n));
    change({
      ...data,
      lessons: [
        ...rest,
        { ...source, id: crypto.randomUUID(), weekday: cell.d, lessonNumber: cell.n },
      ],
    });
  }

  /** Переносит урок; если клетка занята — уроки меняются местами. */
  function move(id: string, cell: Cell) {
    const source = data.lessons.find((l) => l.id === id);
    if (!source || (source.weekday === cell.d && source.lessonNumber === cell.n)) return;
    const target = at(cell);
    change({
      ...data,
      lessons: data.lessons.map((l) =>
        l.id === id
          ? { ...l, weekday: cell.d, lessonNumber: cell.n }
          : l.id === target?.id
            ? { ...l, weekday: source.weekday, lessonNumber: source.lessonNumber }
            : l,
      ),
    });
  }

  const step = (cell: Cell, dd: number, dn: number): Cell | null => {
    const d = cell.d + dd;
    const n = cell.n + dn;
    return d >= 1 && d <= 5 && n >= 1 && n <= ROWS ? { d, n } : null;
  };

  function onCellKey(e: KeyboardEvent<HTMLButtonElement>, cell: Cell) {
    const lesson = at(cell);
    const arrows: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const ctrl = e.ctrlKey || e.metaKey;
    if (arrows[e.key]) {
      const next = step(cell, ...arrows[e.key]);
      if (next && next.n <= rows) select(next);
    } else if (e.key === 'Enter' || e.key === 'F2') editAt(cell);
    else if (e.key === 'Delete' || e.key === 'Backspace') remove(cell);
    else if (ctrl && e.code === 'KeyC' && lesson) {
      setClip(lesson);
      onStatus(`Скопирован урок ${lesson.className || '—'} — вставьте в клетку: Ctrl+V`);
    } else if (ctrl && e.code === 'KeyX' && lesson) {
      setClip(lesson);
      remove(cell);
    } else if (ctrl && e.code === 'KeyV' && clip) put(clip, cell);
    else if (e.key.length === 1 && !ctrl && !e.altKey && e.key !== ' ') editAt(cell, e.key);
    else return;
    e.preventDefault();
  }

  function onFieldKey(e: KeyboardEvent<HTMLInputElement>, cell: Cell, field: string) {
    let next: Cell | null | undefined;
    if (e.key === 'Enter') next = step(cell, 0, e.shiftKey ? -1 : 1);
    else if (e.key === 'Tab' && !e.shiftKey && field === 'room') next = step(cell, 1, 0);
    else if (e.key === 'Tab' && e.shiftKey && field === 'class') next = step(cell, -1, 0);
    else if (e.key === 'Escape') {
      e.preventDefault();
      stopEditing();
      return;
    } else return;
    e.preventDefault();
    if (next) editAt(next);
    else stopEditing();
  }

  function onPointerDown(e: PointerEvent<HTMLButtonElement>, id: string) {
    if (e.button !== 0) return;
    press.current = { id, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
    p.moved = true;
    const under = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>('[data-cell]')?.dataset.cell;
    const [d, n] = under ? under.split('-').map(Number) : [];
    setDrag({ id: p.id, over: under ? { d, n } : null, copy: e.ctrlKey || e.altKey });
  }
  function onPointerUp(e: PointerEvent<HTMLElement>) {
    const p = press.current;
    press.current = null;
    if (!p?.moved) return;
    dragged.current = true;
    const current = drag;
    setDrag(null);
    if (!current?.over) return;
    const source = data.lessons.find((l) => l.id === current.id);
    if (!source) return;
    if (e.ctrlKey || e.altKey) put(source, current.over);
    else move(current.id, current.over);
    select(current.over);
  }

  const draggedFrom = drag && data.lessons.find((l) => l.id === drag.id);

  return (
    <>
      <table
        className={`ed-week${drag ? ' dragging' : ''}`}
        ref={table}
        onPointerMove={onPointerMove}
        onPointerDownCapture={() => (dragged.current = false)}
        onClickCapture={(e) => {
          // Клик после перетаскивания — не открытие урока (ни старой клетки, ни новой).
          if (!dragged.current) return;
          dragged.current = false;
          e.stopPropagation();
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          press.current = null;
          setDrag(null);
        }}
      >
        <thead>
          <tr>
            <th>№</th>
            {weekdays.map((name, i) => (
              <th key={name} title={name}>
                {shortDay[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {numbers.map((n) => {
            const bell = data.bells.find((b) => b.lessonNumber === n);
            return (
              <tr key={n}>
                <th scope="row">
                  {n}
                  {bell && <small>{bell.start}</small>}
                </th>
                {weekdays.map((name, i) => {
                  const cell = { d: i + 1, n };
                  const lesson = at(cell);
                  const selected = sel?.d === cell.d && sel.n === n;
                  const over = drag?.over?.d === cell.d && drag.over.n === n;
                  const classes = [
                    'ed-cell',
                    !lesson && 'blank',
                    selected && 'sel',
                    over && (drag!.copy ? 'drop copy' : 'drop'),
                    draggedFrom && lesson?.id === draggedFrom.id && 'lifted',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const tabIndex = selected || (!sel && n === 1 && i === 0) ? 0 : -1;
                  if (lesson && editing === lesson.id)
                    return (
                      <td
                        key={name}
                        data-cell={key(cell)}
                        onBlur={(e) => {
                          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                          if (editingRef.current === lesson.id) stopEditing(false);
                        }}
                      >
                        <div
                          className="ed-cell ed-cell-edit sel"
                          data-color-tag={
                            data.settings ? lessonColor(lesson, data.settings) : undefined
                          }
                        >
                          <input
                            aria-label="Класс *"
                            data-field="class"
                            list="wk-classes"
                            placeholder="Класс"
                            value={lesson.className}
                            onChange={(e) => update(lesson.id, { className: e.target.value })}
                            onKeyDown={(e) => onFieldKey(e, cell, 'class')}
                          />
                          <div>
                            <input
                              aria-label="Предмет"
                              data-field="subject"
                              list="wk-subjects"
                              placeholder="Предмет"
                              value={lesson.subject}
                              onChange={(e) => update(lesson.id, { subject: e.target.value })}
                              onKeyDown={(e) => onFieldKey(e, cell, 'subject')}
                            />
                            <input
                              aria-label="Кабинет"
                              data-field="room"
                              list="wk-rooms"
                              placeholder="Каб."
                              value={lesson.room}
                              onChange={(e) => update(lesson.id, { room: e.target.value })}
                              onKeyDown={(e) => onFieldKey(e, cell, 'room')}
                            />
                            <button
                              className="ed-icon"
                              tabIndex={-1}
                              aria-label="Время урока"
                              title="Индивидуальное время — в режиме «День»"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => {
                                const id = lesson.id;
                                created.current = null;
                                editingRef.current = null;
                                onOpenDay(cell.d, id);
                              }}
                            >
                              <Icon name="clock" size={12} />
                            </button>
                          </div>
                        </div>
                      </td>
                    );
                  if (!lesson)
                    return (
                      <td key={name} data-cell={key(cell)}>
                        <button
                          className={classes}
                          tabIndex={tabIndex}
                          aria-label={`Добавить урок ${n}, ${name}`}
                          onFocus={() => setSel(cell)}
                          onClick={() => editAt(cell)}
                          onKeyDown={(e) => onCellKey(e, cell)}
                        >
                          {over && draggedFrom ? <b>{draggedFrom.className}</b> : '+'}
                        </button>
                      </td>
                    );
                  return (
                    <td key={name} data-cell={key(cell)}>
                      <button
                        className={classes}
                        tabIndex={tabIndex}
                        data-color-tag={
                          data.settings ? lessonColor(lesson, data.settings) : undefined
                        }
                        title={`${name}, урок ${n}. Перетащите, чтобы перенести; с Ctrl — скопировать`}
                        onFocus={() => setSel(cell)}
                        onPointerDown={(e) => onPointerDown(e, lesson.id)}
                        onClick={() => editAt(cell)}
                        onKeyDown={(e) => onCellKey(e, cell)}
                      >
                        <b>{lesson.className || '—'}</b>
                        <span>
                          {[lesson.subject, lesson.room && `каб. ${lesson.room}`]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                      <button
                        className="ed-cell-del"
                        tabIndex={-1}
                        aria-label={`Удалить урок ${n}, ${name}`}
                        onClick={() => remove(cell)}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="hint ed-week-hint">
        Нажмите на клетку и введите класс. <kbd>Enter</kbd> — урок ниже, <kbd>Tab</kbd> — следующий
        день, <kbd>Esc</kbd> — готово. Перетащите урок, чтобы перенести, с <kbd>Ctrl</kbd> —
        скопировать. Стрелки, <kbd>Delete</kbd>, <kbd>Ctrl+C</kbd> / <kbd>Ctrl+V</kbd> тоже
        работают.
      </p>
      <datalist id="wk-classes">
        {unique(data.lessons.map((l) => l.className)).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="wk-subjects">
        {unique(data.lessons.map((l) => l.subject)).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="wk-rooms">
        {unique(data.lessons.map((l) => l.room)).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  );
}
