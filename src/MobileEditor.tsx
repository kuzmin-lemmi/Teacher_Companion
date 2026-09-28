import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBackButton } from './back';
import {
  generateBells,
  isoDate,
  lessonsForDay,
  minutesOf,
  nextBell,
  publicHolidays,
  shortenBells,
  timeOf,
  weekdays,
  type AppData,
  type DayOff,
  type Lesson,
  type LessonTime,
} from './domain';
import type { useEditor } from './useEditor';
/** Телефон: редактор расписания — списки со строками и нижняя панель для правки одной записи. */
type Editor = ReturnType<typeof useEditor>;
const shortDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
const inDay = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу'];
const fromIso = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const dayMonthShort = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const weekdayShort = new Intl.DateTimeFormat('ru', { weekday: 'short' });
const validIso = (value: string) => /^\d{4}-\d\d-\d\d$/.test(value);
function range(h: DayOff) {
  if (!validIso(h.start) || !validIso(h.end)) return 'Даты не указаны';
  if (h.start === h.end) return dayMonth.format(fromIso(h.start));
  return `${dayMonthShort.format(fromIso(h.start))} — ${dayMonthShort.format(fromIso(h.end))}`;
}
function shortDayLabel(value: string) {
  if (!validIso(value)) return 'Дата не указана';
  const date = fromIso(value);
  return `${weekdayShort.format(date)}, ${dayMonth.format(date)}`;
}
const duration = (t: { start: string; end: string }) =>
  /^\d\d:\d\d$/.test(t.start) && /^\d\d:\d\d$/.test(t.end)
    ? minutesOf(t.end) - minutesOf(t.start)
    : 0;
/** Частые значения — первыми: учитель обычно ведёт один предмет в одном кабинете. */
function popular(values: string[]) {
  const counts = new Map<string, number>();
  for (const v of values.map((v) => v.trim()).filter(Boolean))
    counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru', { numeric: true }))
    .map(([v]) => v);
}
const icon = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);
export const chevronLeft = icon('M15 5l-7 7 7 7');
export const chevronRight = icon('M9 5l7 7-7 7');
const plusIcon = icon('M12 5v14M5 12h14');
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useBackButton(true, onClose);
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && latest.current();
    window.addEventListener('keydown', onKey);
    document.documentElement.classList.add('sheet-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('sheet-open');
    };
  }, []);
  return createPortal(
    <div className="m-sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="m-sheet-grip" />
        <header>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </header>
        <div
          className="m-sheet-body"
          // Клавиатура закрывает низ панели: поле, в которое пишут, прокручиваем в середину.
          onFocus={(e) => {
            const target = e.target as HTMLElement;
            if (target.matches('input'))
              setTimeout(() => target.scrollIntoView?.({ block: 'center' }), 300);
          }}
        >
          {children}
        </div>
        {footer && <div className="m-sheet-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
function TextField({
  label,
  value,
  onChange,
  placeholder,
  suggestions = [],
  autoFocus,
  maxLength = 100,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  suggestions?: string[];
  autoFocus?: boolean;
  maxLength?: number;
}) {
  const typed = value.trim().toLowerCase();
  // Поле уже совпадает с вариантом — показываем остальные, иначе — те, что начинаются так же.
  const exact = suggestions.some((s) => s.toLowerCase() === typed);
  const chips = suggestions
    .filter((s) => s.toLowerCase() !== typed && (exact || s.toLowerCase().startsWith(typed)))
    .slice(0, 12);
  return (
    <div className="m-field">
      <label>
        <span>{label}</span>
        <input
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoCapitalize="sentences"
          enterKeyHint="done"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </label>
      {chips.length > 0 && (
        <div className="m-chips" role="group" aria-label={`${label}: быстрый выбор`}>
          {chips.map((chip) => (
            <button key={chip} type="button" onClick={() => onChange(chip)}>
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  skip,
  format = String,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Занятые значения, через которые кнопки перескакивают. */
  skip?: (value: number) => boolean;
  format?: (value: number) => string;
}) {
  const target = (dir: 1 | -1) => {
    let n = value + dir * step;
    while (n >= min && n <= max && skip?.(n)) n += dir * step;
    return n >= min && n <= max ? n : null;
  };
  const down = target(-1);
  const up = target(1);
  return (
    <div className="m-field m-stepper">
      <span>{label}</span>
      <div>
        <button
          type="button"
          aria-label={`${label}: меньше`}
          disabled={down === null}
          onClick={() => down !== null && onChange(down)}
        >
          −
        </button>
        <output aria-live="polite">{format(value)}</output>
        <button
          type="button"
          aria-label={`${label}: больше`}
          disabled={up === null}
          onClick={() => up !== null && onChange(up)}
        >
          +
        </button>
      </div>
    </div>
  );
}
export function TimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="m-field">
      <span>{label}</span>
      <input type="time" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="m-field">
      <span>{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="m-switch">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
function SheetButtons({ onDelete, onDone }: { onDelete?: () => void; onDone: () => void }) {
  return (
    <>
      {onDelete && (
        <button type="button" className="m-danger" onClick={onDelete}>
          Удалить
        </button>
      )}
      <button type="button" className="m-primary" onClick={onDone}>
        Готово
      </button>
    </>
  );
}
function AddButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="m-add" disabled={disabled} onClick={onClick}>
      {plusIcon}
      {children}
    </button>
  );
}
export function EditorStatus({ editor }: { editor: Editor }) {
  if (!editor.errors.length && !editor.failed) return null;
  return (
    <div role="alert" className="m-alert">
      {editor.failed ? (
        <>
          <p>{editor.status}</p>
          <button type="button" onClick={editor.flush}>
            Повторить сохранение
          </button>
        </>
      ) : (
        <>
          <strong>Пока не видно в расписании — исправьте:</strong>
          <ul>
            {editor.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
/* ───────────── Уроки ───────────── */
export function LessonsPage({ editor }: { editor: Editor }) {
  const { data, change } = editor;
  const [day, setDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [editing, setEditing] = useState<{ id: string; fresh: boolean } | null>(null);
  const lessons = lessonsForDay(data.lessons, day);
  const byNumber = new Map(lessons.map((l) => [l.lessonNumber, l]));
  const last = lessons.at(-1)?.lessonNumber ?? 0;
  const first = lessons[0]?.lessonNumber ?? 1;
  const others = (weekday: number) => data.lessons.filter((l) => l.weekday !== weekday);
  function add(number: number) {
    // Предмет и кабинет подставляем самые частые — обычно остаётся вписать только класс.
    const lesson: Lesson = {
      id: crypto.randomUUID(),
      weekday: day,
      lessonNumber: number,
      className: '',
      subject: popular(data.lessons.map((l) => l.subject))[0] ?? '',
      room: popular(data.lessons.map((l) => l.room))[0] ?? '',
    };
    change({ ...data, lessons: [...data.lessons, lesson] });
    setEditing({ id: lesson.id, fresh: true });
  }
  function copyFrom(weekday: number) {
    const copied = lessonsForDay(data.lessons, weekday).map((l) => ({
      ...l,
      id: crypto.randomUUID(),
      weekday: day,
    }));
    change({ ...data, lessons: [...others(day), ...copied] });
    editor.setStatus(`Уроки скопированы: ${shortDays[weekday - 1]} → ${shortDays[day - 1]}`);
  }
  const current = editing && data.lessons.find((l) => l.id === editing.id);
  const rows: ReactNode[] = [];
  for (let n = first; n <= last; n++) {
    const lesson = byNumber.get(n);
    if (!lesson) {
      rows.push(
        <button key={`gap-${n}`} type="button" className="m-row m-gap" onClick={() => add(n)}>
          <span className="m-num">{n}</span>
          <span className="m-row-main">
            <strong>Окно</strong>
            <small>Нажмите, чтобы поставить урок</small>
          </span>
          {plusIcon}
        </button>,
      );
      continue;
    }
    const time = timeOf(lesson, data.bells);
    const details = [lesson.subject.trim(), lesson.room.trim() && `каб. ${lesson.room.trim()}`]
      .filter(Boolean)
      .join(' · ');
    rows.push(
      <button
        key={lesson.id}
        type="button"
        className={`m-row ${lesson.className.trim() ? '' : 'invalid'}`}
        onClick={() => setEditing({ id: lesson.id, fresh: false })}
      >
        <span className="m-num">{n}</span>
        <span className="m-row-main">
          <strong>{lesson.className.trim() || 'Укажите класс'}</strong>
          {details && <small>{details}</small>}
        </span>
        <span className="m-row-time">
          {time ? (
            <>
              {time.start}
              <small>
                {time.end}
                {lesson.customTime ? ' · своё' : ''}
              </small>
            </>
          ) : (
            <small>нет звонка</small>
          )}
        </span>
      </button>,
    );
  }
  const filledDays = [1, 2, 3, 4, 5].filter(
    (d) => d !== day && data.lessons.some((l) => l.weekday === d),
  );
  return (
    <>
      <div className="m-days" role="tablist" aria-label="День недели">
        {shortDays.map((name, i) => {
          const count = data.lessons.filter((l) => l.weekday === i + 1).length;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={day === i + 1}
              aria-label={`${weekdays[i]}, ${count}`}
              onClick={() => setDay(i + 1)}
            >
              {name}
              <small>{count || '·'}</small>
            </button>
          );
        })}
      </div>
      <EditorStatus editor={editor} />
      {lessons.length ? (
        <div className="m-list">{rows}</div>
      ) : (
        <div className="m-empty">
          <h2>На {inDay[day - 1]} уроков нет</h2>
          <p>Добавьте первый урок — время подставится из звонков.</p>
          {filledDays.length > 0 && (
            <div className="m-copy">
              <span>Или скопируйте день целиком:</span>
              <div className="m-chips">
                {filledDays.map((d) => (
                  <button key={d} type="button" onClick={() => copyFrom(d)}>
                    {shortDays[d - 1]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <AddButton disabled={last >= 20} onClick={() => add(last + 1)}>
        Добавить {last + 1}-й урок
      </AddButton>
      {editor.status && !editor.failed && <p className="m-status">{editor.status}</p>}
      {current && editing && (
        <LessonSheet
          lesson={current}
          data={data}
          fresh={editing.fresh}
          onChange={(patch) =>
            change({
              ...data,
              lessons: data.lessons.map((l) => (l.id === current.id ? { ...l, ...patch } : l)),
            })
          }
          onDelete={() => {
            change({ ...data, lessons: data.lessons.filter((l) => l.id !== current.id) });
            setEditing(null);
          }}
          onClose={() => {
            // Новый урок без класса — передумали добавлять.
            if (editing.fresh && !current.className.trim())
              change({ ...data, lessons: data.lessons.filter((l) => l.id !== current.id) });
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
function LessonSheet({
  lesson,
  data,
  fresh,
  onChange,
  onDelete,
  onClose,
}: {
  lesson: Lesson;
  data: AppData;
  fresh: boolean;
  onChange: (patch: Partial<Lesson>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const time = timeOf(lesson, data.bells);
  const bell = data.bells.find((b) => b.lessonNumber === lesson.lessonNumber);
  const taken = new Set(
    lessonsForDay(data.lessons, lesson.weekday)
      .filter((l) => l.id !== lesson.id)
      .map((l) => l.lessonNumber),
  );
  return (
    <Sheet
      title={fresh ? 'Новый урок' : `${lesson.lessonNumber}-й урок`}
      subtitle={`${weekdays[lesson.weekday - 1]}${time ? ` · ${time.start}–${time.end}` : ''}`}
      onClose={onClose}
      footer={<SheetButtons onDelete={fresh ? undefined : onDelete} onDone={onClose} />}
    >
      <TextField
        label="Класс"
        placeholder="Например, 7Б"
        value={lesson.className}
        autoFocus={fresh}
        maxLength={40}
        suggestions={popular(data.lessons.map((l) => l.className))}
        onChange={(className) => onChange({ className })}
      />
      <TextField
        label="Предмет"
        placeholder="Необязательно"
        value={lesson.subject}
        suggestions={popular(data.lessons.map((l) => l.subject))}
        onChange={(subject) => onChange({ subject })}
      />
      <TextField
        label="Кабинет"
        placeholder="Необязательно"
        value={lesson.room}
        maxLength={40}
        suggestions={popular(data.lessons.map((l) => l.room))}
        onChange={(room) => onChange({ room })}
      />
      <Stepper
        label="Номер урока"
        value={lesson.lessonNumber}
        min={1}
        max={20}
        skip={(n) => taken.has(n)}
        onChange={(lessonNumber) => onChange({ lessonNumber })}
      />
      <Switch
        label="Своё время"
        hint={
          lesson.customTime
            ? 'Для этого урока звонки не действуют'
            : bell
              ? `По звонкам: ${bell.start}–${bell.end}`
              : 'Для этого номера звонок не задан'
        }
        checked={!!lesson.customTime}
        onChange={(on) =>
          onChange({
            customTime: on
              ? { start: time?.start ?? '08:30', end: time?.end ?? '09:15' }
              : undefined,
          })
        }
      />
      {lesson.customTime && (
        <div className="m-pair">
          <TimeField
            label="Начало"
            value={lesson.customTime.start}
            onChange={(start) => onChange({ customTime: { ...lesson.customTime!, start } })}
          />
          <TimeField
            label="Конец"
            value={lesson.customTime.end}
            onChange={(end) => onChange({ customTime: { ...lesson.customTime!, end } })}
          />
        </div>
      )}
    </Sheet>
  );
}
/* ───────────── Звонки ───────────── */
function BellList({
  bells,
  onChange,
  title,
}: {
  bells: LessonTime[];
  onChange: (bells: LessonTime[]) => void;
  title: string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const ordered = bells
    .map((bell, index) => ({ bell, index }))
    .sort((a, b) => a.bell.lessonNumber - b.bell.lessonNumber);
  const current = editing === null ? null : bells[editing];
  const rows: ReactNode[] = [];
  ordered.forEach(({ bell, index }, i) => {
    const previous = ordered[i - 1]?.bell;
    if (previous && /^\d\d:\d\d$/.test(previous.end) && /^\d\d:\d\d$/.test(bell.start)) {
      const rest = minutesOf(bell.start) - minutesOf(previous.end);
      rows.push(
        <p key={`rest-${index}`} className={`m-break ${rest < 0 ? 'invalid' : ''}`}>
          {rest < 0 ? 'уроки пересекаются' : rest ? `перемена ${rest} мин` : 'без перемены'}
        </p>,
      );
    }
    const length = duration(bell);
    rows.push(
      <button
        key={index}
        type="button"
        className={`m-row ${length > 0 ? '' : 'invalid'}`}
        onClick={() => setEditing(index)}
      >
        <span className="m-num">{bell.lessonNumber}</span>
        <span className="m-row-main">
          <strong>
            {bell.start || '––:––'} — {bell.end || '––:––'}
          </strong>
        </span>
        <span className="m-row-time">
          <small>{length > 0 ? `${length} мин` : 'проверьте'}</small>
        </span>
      </button>,
    );
  });
  const taken = new Set(bells.filter((_, i) => i !== editing).map((b) => b.lessonNumber));
  const patch = (value: Partial<LessonTime>) =>
    onChange(bells.map((b, j) => (j === editing ? { ...b, ...value } : b)));
  return (
    <>
      {rows.length > 0 && <div className="m-list">{rows}</div>}
      <AddButton
        disabled={bells.length >= 20}
        onClick={() => {
          onChange([...bells, nextBell(bells)]);
          setEditing(bells.length);
        }}
      >
        Добавить звонок
      </AddButton>
      {current && (
        <Sheet
          title={`${current.lessonNumber}-й урок`}
          subtitle={title}
          onClose={() => setEditing(null)}
          footer={
            <SheetButtons
              onDelete={() => {
                onChange(bells.filter((_, j) => j !== editing));
                setEditing(null);
              }}
              onDone={() => setEditing(null)}
            />
          }
        >
          <div className="m-pair">
            <TimeField
              label="Начало"
              value={current.start}
              onChange={(start) => patch({ start })}
            />
            <TimeField label="Конец" value={current.end} onChange={(end) => patch({ end })} />
          </div>
          <Stepper
            label="Номер урока"
            value={current.lessonNumber}
            min={1}
            max={20}
            skip={(n) => taken.has(n)}
            onChange={(lessonNumber) => patch({ lessonNumber })}
          />
        </Sheet>
      )}
    </>
  );
}
function BellGenerator({
  replacing,
  onApply,
  onClose,
}: {
  replacing: boolean;
  onApply: (bells: LessonTime[]) => void;
  onClose: () => void;
}) {
  const [first, setFirst] = useState('08:30');
  const [count, setCount] = useState(7);
  const [lesson, setLesson] = useState(45);
  const [rest, setRest] = useState(10);
  const preview = /^\d\d:\d\d$/.test(first) ? generateBells(first, count, lesson, rest) : [];
  return (
    <Sheet
      title="Заполнить звонки"
      subtitle={replacing ? 'Текущие звонки будут заменены' : 'Потом любой звонок можно поправить'}
      onClose={onClose}
      footer={
        <button
          type="button"
          className="m-primary"
          disabled={!preview.length}
          onClick={() => onApply(preview)}
        >
          {preview.length
            ? `Заполнить: ${preview[0].start}–${preview.at(-1)!.end}`
            : 'Укажите начало'}
        </button>
      }
    >
      <TimeField label="Начало первого урока" value={first} onChange={setFirst} />
      <Stepper label="Уроков в день" value={count} min={1} max={12} onChange={setCount} />
      <Stepper
        label="Длина урока"
        value={lesson}
        min={20}
        max={90}
        step={5}
        format={(v) => `${v} мин`}
        onChange={setLesson}
      />
      <Stepper
        label="Перемена"
        value={rest}
        min={0}
        max={40}
        step={5}
        format={(v) => `${v} мин`}
        onChange={setRest}
      />
      <p className="m-hint">Большую перемену после любого урока можно задать потом.</p>
    </Sheet>
  );
}
export function BellsPage({ editor }: { editor: Editor }) {
  const { data, change } = editor;
  const [generator, setGenerator] = useState(false);
  return (
    <>
      <EditorStatus editor={editor} />
      {!data.bells.length && (
        <div className="m-empty">
          <h2>Звонков пока нет</h2>
          <p>Заполните все звонки разом: начало, длина урока и перемены.</p>
          <button type="button" className="m-primary" onClick={() => setGenerator(true)}>
            Заполнить звонки
          </button>
        </div>
      )}
      <BellList
        bells={data.bells}
        title="Обычные звонки"
        onChange={(bells) => change({ ...data, bells })}
      />
      {data.bells.length > 0 && (
        <button type="button" className="m-link" onClick={() => setGenerator(true)}>
          Заполнить заново
        </button>
      )}
      <p className="m-hint">
        Время действует для всех уроков с этим номером, кроме уроков со своим временем.
      </p>
      {generator && (
        <BellGenerator
          replacing={data.bells.length > 0}
          onClose={() => setGenerator(false)}
          onApply={(bells) => {
            change({ ...data, bells });
            setGenerator(false);
          }}
        />
      )}
    </>
  );
}
/* ───────────── Каникулы и сокращённые дни ───────────── */
export function CalendarPage({ editor }: { editor: Editor }) {
  const { data, change } = editor;
  const [holiday, setHoliday] = useState<{ id: string; fresh: boolean } | null>(null);
  const [shortDay, setShortDay] = useState<number | null>(null);
  const [shorten, setShorten] = useState(false);
  const [shortLesson, setShortLesson] = useState(30);
  const [shortBreak, setShortBreak] = useState(10);
  const current = holiday && data.holidays.find((h) => h.id === holiday.id);
  const patchHoliday = (value: Partial<DayOff>) =>
    change({
      ...data,
      holidays: data.holidays.map((h) => (h.id === current?.id ? { ...h, ...value } : h)),
    });
  const holidays = [...data.holidays].sort((a, b) => a.start.localeCompare(b.start));
  const today = isoDate(new Date());
  return (
    <>
      <EditorStatus editor={editor} />
      <section className="m-section">
        <h2>Каникулы и праздники</h2>
        <p className="m-hint">
          В эти дни уроков нет — на главном экране сразу следующий учебный день.
        </p>
        {holidays.length > 0 && (
          <div className="m-list">
            {holidays.map((h) => (
              <button
                key={h.id}
                type="button"
                className={`m-row ${h.end < today ? 'past' : ''}`}
                onClick={() => setHoliday({ id: h.id, fresh: false })}
              >
                <span className="m-row-main">
                  <strong>{h.title.trim() || 'Без названия'}</strong>
                  <small>{range(h)}</small>
                </span>
                {chevronRight}
              </button>
            ))}
          </div>
        )}
        <div className="m-actions">
          <AddButton
            disabled={data.holidays.length >= 100}
            onClick={() => {
              const id = crypto.randomUUID();
              change({
                ...data,
                holidays: [...data.holidays, { id, title: '', start: today, end: today }],
              });
              setHoliday({ id, fresh: true });
            }}
          >
            Каникулы
          </AddButton>
          <AddButton
            onClick={() => {
              const known = new Set(data.holidays.map((h) => h.start));
              const added = publicHolidays(new Date())
                .filter((h) => !known.has(h.start))
                .map((h) => ({ ...h, id: crypto.randomUUID() }));
              change({ ...data, holidays: [...data.holidays, ...added] });
              editor.setStatus(
                added.length
                  ? `Добавлено праздников: ${added.length}`
                  : 'Праздники этого учебного года уже в списке',
              );
            }}
          >
            Праздники
          </AddButton>
        </div>
        {editor.status && !editor.failed && <p className="m-status">{editor.status}</p>}
      </section>
      <section className="m-section">
        <h2>Сокращённые дни</h2>
        <p className="m-hint">В эти даты время уроков берётся из сокращённых звонков.</p>
        {data.shortDays.length > 0 && (
          <div className="m-list">
            {data.shortDays.map((date, i) => (
              <button
                key={i}
                type="button"
                className={`m-row ${date < today ? 'past' : ''}`}
                onClick={() => setShortDay(i)}
              >
                <span className="m-row-main">
                  <strong>{shortDayLabel(date)}</strong>
                </span>
                {chevronRight}
              </button>
            ))}
          </div>
        )}
        <AddButton
          disabled={data.shortDays.length >= 200}
          onClick={() => {
            const date = new Date();
            while (data.shortDays.includes(isoDate(date))) date.setDate(date.getDate() + 1);
            change({ ...data, shortDays: [...data.shortDays, isoDate(date)] });
            setShortDay(data.shortDays.length);
          }}
        >
          Сокращённый день
        </AddButton>
      </section>
      <section className="m-section">
        <h2>Сокращённые звонки</h2>
        {data.shortDays.length > 0 && !data.shortBells.length && (
          <p className="m-hint">Пока их нет, в сокращённые дни действует обычное время.</p>
        )}
        {data.bells.length > 0 && (
          <button type="button" className="m-secondary" onClick={() => setShorten(true)}>
            Рассчитать от обычных звонков
          </button>
        )}
        <BellList
          bells={data.shortBells}
          title="Сокращённые звонки"
          onChange={(shortBells) => change({ ...data, shortBells })}
        />
      </section>
      {current && holiday && (
        <Sheet
          title={holiday.fresh ? 'Новые каникулы' : current.title.trim() || 'Без названия'}
          subtitle="Для одного дня укажите одинаковые даты"
          onClose={() => setHoliday(null)}
          footer={
            <SheetButtons
              onDelete={() => {
                change({ ...data, holidays: data.holidays.filter((h) => h.id !== current.id) });
                setHoliday(null);
              }}
              onDone={() => setHoliday(null)}
            />
          }
        >
          <TextField
            label="Название"
            placeholder="Например, осенние каникулы"
            value={current.title}
            autoFocus={holiday.fresh}
            suggestions={[
              'Осенние каникулы',
              'Зимние каникулы',
              'Весенние каникулы',
              'Летние каникулы',
            ]}
            onChange={(title) => patchHoliday({ title })}
          />
          <div className="m-pair">
            <DateField
              label="С"
              value={current.start}
              onChange={(start) =>
                // Начало позже конца — сдвигаем и конец: чаще всего это один день.
                patchHoliday({ start, ...(start > current.end ? { end: start } : {}) })
              }
            />
            <DateField label="По" value={current.end} onChange={(end) => patchHoliday({ end })} />
          </div>
        </Sheet>
      )}
      {shortDay !== null && shortDay < data.shortDays.length && (
        <Sheet
          title="Сокращённый день"
          onClose={() => setShortDay(null)}
          footer={
            <SheetButtons
              onDelete={() => {
                change({ ...data, shortDays: data.shortDays.filter((_, j) => j !== shortDay) });
                setShortDay(null);
              }}
              onDone={() => setShortDay(null)}
            />
          }
        >
          <DateField
            label="Дата"
            value={data.shortDays[shortDay]}
            onChange={(value) =>
              change({
                ...data,
                shortDays: data.shortDays.map((d, j) => (j === shortDay ? value : d)),
              })
            }
          />
        </Sheet>
      )}
      {shorten && (
        <Sheet
          title="Рассчитать сокращённые звонки"
          subtitle="Первый урок начнётся как обычно"
          onClose={() => setShorten(false)}
          footer={
            <button
              type="button"
              className="m-primary"
              onClick={() => {
                change({
                  ...data,
                  shortBells: shortenBells(data.bells, shortLesson, shortBreak),
                });
                setShorten(false);
              }}
            >
              Рассчитать
            </button>
          }
        >
          <Stepper
            label="Длина урока"
            value={shortLesson}
            min={10}
            max={45}
            step={5}
            format={(v) => `${v} мин`}
            onChange={setShortLesson}
          />
          <Stepper
            label="Перемена"
            value={shortBreak}
            min={0}
            max={30}
            step={5}
            format={(v) => `${v} мин`}
            onChange={setShortBreak}
          />
        </Sheet>
      )}
    </>
  );
}
