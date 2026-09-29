import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  NOTE_MAX_LENGTH,
  autoDayMode,
  countdown,
  dayOf,
  dayOff,
  getNextSchoolDay,
  isoDate,
  matchColorTag,
  type AppData,
  type DayMode,
  type DayOff,
  type Lesson,
  weekdays,
} from './domain';
import { lessonCount } from './calendar';
import { useBackButton } from './back';
import { useClock } from './hooks';
import { useBellAlert } from './bellAlert';
import { hasChecklist, parseChecklist, toggleChecklistItem } from './checklist';
type Props = {
  data: AppData;
  /** `auto` — сегодня до конца последнего урока, потом следующий учебный день. */
  mode: DayMode | 'auto';
  onMode: (mode: DayMode) => void;
  onSettings: () => void;
  /** Пустая неделя: сразу перейти к восстановлению копии, например на втором компьютере. */
  onBackups?: () => void;
  /** Без обработчиков (на телефоне) кнопки «закрепить» и «скрыть» не показываются. */
  onClose?: () => void;
  onLock?: () => void;
  onDrag: () => void;
  /** Естественная высота виджета в CSS-пикселях — по ней подгоняется окно. */
  onMeasure?: (height: number) => void;
  /** Есть новая версия — маленькая точка на кнопке настроек, без всплывающих окон. */
  updateAvailable?: boolean;
  /** Заметка к уроку на дату (`YYYY-MM-DD`); пустой текст убирает её. Без обработчика строки не редактируются. */
  onNote?: (date: string, lessonNumber: number, text: string) => void;
  /** `screen` — телефон: весь экран, крупные строки, нижняя панель вместо кнопок в шапке. */
  layout?: 'widget' | 'screen';
};
type Row = { kind: 'lesson'; lesson: Lesson } | { kind: 'gap'; number: number };
const weekdayName = new Intl.DateTimeFormat('ru', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const fromIso = (value: string) => {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
};
/** «Осенние каникулы · до 8 ноября» или «День народного единства · 4 ноября». */
function offLabel(off: DayOff) {
  const title = off.title.trim() || 'Выходной';
  return off.start === off.end
    ? `${title} · ${dayMonth.format(fromIso(off.start))}`
    : `${title} · до ${dayMonth.format(fromIso(off.end))}`;
}
function NoteEditor({
  initial,
  label,
  onDone,
}: {
  initial: string;
  label: string;
  /** `null` — отмена без сохранения. */
  onDone: (text: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  // На телефоне клавиатура выезжает не сразу — после неё возвращаем поле в поле зрения.
  useEffect(() => {
    const timer = setTimeout(() => input.current?.scrollIntoView?.({ block: 'center' }), 350);
    return () => clearTimeout(timer);
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  const insertBox = () => {
    const el = input.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const prefix = text.slice(0, start);
    const suffix = text.slice(end);
    const space = prefix.length && !prefix.endsWith(' ') && !prefix.endsWith('\n') ? ' ' : '';
    const inserted = `${space}[ ] `;
    const next = (prefix + inserted + suffix).slice(0, NOTE_MAX_LENGTH);
    setText(next);
    setTimeout(() => {
      el.focus();
      const pos = start + inserted.length;
      el.setSelectionRange(pos, pos);
    }, 0);
  };
  return (
    <div className="row-note-editor-wrap">
      <input
        ref={input}
        className="row-note-input"
        autoFocus
        enterKeyHint="done"
        aria-label={label}
        placeholder="Что не забыть? Например: [ ] Раздать тетради"
        title="Enter — сохранить, Esc — отмена"
        maxLength={NOTE_MAX_LENGTH}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(text);
          if (e.key === 'Escape') {
            e.stopPropagation();
            finish(null);
          }
        }}
        onBlur={() => finish(text)}
      />
      <button
        type="button"
        className="note-insert-checkbox"
        title="Вставить задачу [ ]"
        tabIndex={-1}
        onMouseDown={(e) => {
          e.preventDefault();
          insertBox();
        }}
      >
        + [ ]
      </button>
    </div>
  );
}
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isNextDay = (a: Date, b: Date) =>
  new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1).toDateString() === b.toDateString();
function shared(values: string[]) {
  const first = values[0]?.trim();
  return first && values.every((v) => v.trim() === first) ? first : '';
}
function rowsOf(lessons: Lesson[]): Row[] {
  const rows: Row[] = [];
  lessons.forEach((lesson, i) => {
    if (i)
      for (let n = lessons[i - 1].lessonNumber + 1; n < lesson.lessonNumber; n++)
        rows.push({ kind: 'gap', number: n });
    rows.push({ kind: 'lesson', lesson });
  });
  return rows;
}
const icon = (path: ReactNode) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);
const pinIcon = icon(<path d="M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5" />);
const gearIcon = icon(
  <>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05" />
  </>,
);
const closeIcon = icon(<path d="M4 4l8 8M12 4l-8 8" />);
const weekIcon = icon(
  <>
    <rect x="2.25" y="3" width="11.5" height="10.75" rx="2" />
    <path d="M2.25 6.5h11.5M5.5 1.75v2.5M10.5 1.75v2.5M6 9.5h.01M8 9.5h.01M10 9.5h.01M6 11.5h.01M8 11.5h.01" />
  </>,
);
const shortDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
function WeekTable({ data, today, compact }: { data: AppData; today: number; compact: boolean }) {
  const last = Math.max(0, ...data.lessons.map((l) => l.lessonNumber));
  if (!last)
    return (
      <div className="widget-empty">
        <h2>Неделя пока пустая</h2>
        <p>Добавьте уроки в настройках.</p>
      </div>
    );
  const numbers = Array.from({ length: last }, (_, i) => i + 1);
  const at = (day: number, n: number) =>
    data.lessons.find((l) => l.weekday === day && l.lessonNumber === n);
  return (
    <table className="week-table">
      <thead>
        <tr>
          <th scope="col">
            <span className="visually-hidden">Урок</span>
          </th>
          {shortDays.map((d, i) => (
            <th key={d} scope="col" className={today === i + 1 ? 'today' : ''} title={weekdays[i]}>
              {d}
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
                {!compact && bell && <small>{bell.start}</small>}
              </th>
              {shortDays.map((d, i) => {
                const lesson = at(i + 1, n);
                const tag = lesson ? matchColorTag(lesson, data.settings.colorTags) : undefined;
                return (
                  <td
                    key={d}
                    className={today === i + 1 ? 'today' : ''}
                    data-color-tag={tag?.color}
                    title={
                      lesson
                        ? [
                            weekdays[i],
                            lesson.className,
                            lesson.subject,
                            lesson.room && `каб. ${lesson.room}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : undefined
                    }
                  >
                    {lesson ? lesson.className : <span className="week-empty">·</span>}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
export function Widget({
  data,
  mode,
  onMode,
  onSettings,
  onBackups,
  onClose,
  onLock,
  onDrag,
  onMeasure,
  updateAvailable = false,
  onNote,
  layout = 'widget',
}: Props) {
  const now = useClock();
  const [week, setWeek] = useState(false);
  const screen = layout === 'screen';
  useBackButton(week, () => setWeek(false));
  const [editing, setEditing] = useState<string | null>(null);
  const next = getNextSchoolDay(data, now);
  const shown = mode === 'auto' ? autoDayMode(data, now) : mode;
  const date = shown === 'today' ? now : next;
  const day = date ? dayOf(data, date) : null;
  const dateKey = date ? isoDate(date) : '';
  const lessons = day?.lessons ?? [];
  // Между сегодня и показанным днём — каникулы или праздник: подсказываем, почему день не завтра.
  const tomorrow = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const skipped =
    shown === 'next' && next
      ? (dayOff(data, now) ??
        data.holidays.find((h) => h.end >= tomorrow && h.start < isoDate(next)))
      : undefined;
  const notice = day?.short ? 'Сокращённые уроки' : skipped ? offLabel(skipped) : '';
  const compact = data.settings.widgetSize === 'compact';
  const { locked } = data.settings;
  const subject = shared(lessons.map((l) => l.subject));
  const room = shared(lessons.map((l) => l.room));
  const showSubject = !compact && !subject && lessons.some((l) => l.subject.trim());
  const showRoom = !compact && !room && lessons.some((l) => l.room.trim());
  const clock = now.toTimeString().slice(0, 5);
  const timer = shown === 'today' && day ? countdown(day, now) : null;
  const { activeAlert, dismissAlert } = useBellAlert(data, day, timer, dateKey);
  const nextLabel = !next
    ? 'Следующий'
    : isNextDay(now, next)
      ? 'Завтра'
      : capitalize(weekdayName.format(next));
  // В компактном виджете рядом четыре кнопки, а «Сегодня» / «Завтра» уже есть на переключателе внизу.
  const prefix = (word: string) => (compact && !screen ? '' : `${word}, `);
  const subtitle =
    shown === 'today'
      ? `${prefix('Сегодня')}${dayMonth.format(now)}`
      : date
        ? `${isNextDay(now, date) ? prefix('Завтра') : ''}${dayMonth.format(date)}`
        : 'Пока пусто';
  const meta = lessons.length
    ? [subject, room && `каб. ${room}`].filter(Boolean).join(' · ') || lessonCount(lessons.length)
    : '';
  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const reported = useRef(0);
  const measure = useRef(() => {});
  measure.current = () => {
    const card = root.current;
    const body = list.current;
    if (!card || !body) return;
    const height = Math.ceil(card.offsetHeight - body.clientHeight + body.scrollHeight);
    if (height > 0 && Math.abs(height - reported.current) > 1) {
      reported.current = height;
      onMeasure?.(height);
    }
  };
  useLayoutEffect(() => measure.current());
  useEffect(() => {
    const run = () => measure.current();
    void document.fonts?.ready.then(run);
    window.addEventListener('resize', run);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(run);
    if (root.current) observer?.observe(root.current);
    return () => {
      window.removeEventListener('resize', run);
      observer?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!week) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWeek(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [week]);
  const timeText = (t: { start: string; end: string } | undefined) =>
    t ? (compact ? t.start : `${t.start}–${t.end}`) : '—';
  return (
    <section
      ref={root}
      className={`schedule-widget ${compact ? 'compact' : ''} ${screen ? 'screen' : ''}`}
      style={{ '--widget-alpha': data.settings.opacity / 100 } as CSSProperties}
      aria-label="Виджет расписания"
    >
      <div
        className={`widget-top ${locked ? 'locked' : ''}`}
        onPointerDown={(e) => {
          if (!screen && e.button === 0 && !(e.target as HTMLElement).closest('button')) onDrag();
        }}
      >
        <div className="widget-title">
          <h1>{week ? 'Неделя' : date ? capitalize(weekdayName.format(date)) : 'Расписание'}</h1>
          <p>{week ? `Пн–Пт · ${lessonCount(data.lessons.length)}` : subtitle}</p>
          {screen && !week && meta && <p className="screen-meta">{meta}</p>}
        </div>
        {screen ? null : week ? (
          <div className="widget-actions">
            <button
              aria-label="Закрыть неделю"
              title="Закрыть (Esc)"
              autoFocus
              onClick={() => setWeek(false)}
            >
              {closeIcon}
            </button>
          </div>
        ) : (
          <div className="widget-actions">
            <button
              aria-label="Вся неделя"
              title="Расписание на неделю"
              onClick={() => setWeek(true)}
            >
              {weekIcon}
            </button>
            {onLock && (
              <button
                aria-label={locked ? 'Открепить виджет' : 'Закрепить виджет'}
                title={
                  locked ? 'Закреплён — нажмите, чтобы разрешить перемещение' : 'Закрепить на месте'
                }
                aria-pressed={locked}
                onClick={onLock}
              >
                {pinIcon}
              </button>
            )}
            <button
              aria-label="Открыть настройки"
              title={updateAvailable ? 'Настройки · доступна новая версия' : 'Настройки'}
              className={updateAvailable ? 'has-update' : undefined}
              onClick={onSettings}
            >
              {gearIcon}
            </button>
            {onClose && (
              <button aria-label="Закрыть виджет" title="Скрыть" onClick={onClose}>
                {closeIcon}
              </button>
            )}
          </div>
        )}
      </div>
      <div ref={list} className="widget-lessons">
        {week ? (
          <WeekTable data={data} today={now.getDay()} compact={compact} />
        ) : !data.lessons.length ? (
          <div className="widget-empty">
            <h2>Добавьте первые уроки</h2>
            <p>
              {screen
                ? 'Заполните неделю или перенесите расписание с компьютера по QR-коду.'
                : 'Заполните неделю или загрузите резервную копию с другого компьютера.'}
            </p>
            <div className="widget-empty-actions">
              <button className="primary" onClick={onSettings}>
                Настроить расписание
              </button>
              {onBackups && (
                <button className="secondary" onClick={onBackups}>
                  {screen ? 'Перенести с компьютера' : 'Загрузить резервную копию'}
                </button>
              )}
            </div>
          </div>
        ) : !lessons.length ? (
          <div className="widget-empty">
            <h2>{day?.off ? 'Сегодня выходной' : 'Сегодня занятий нет'}</h2>
            <p>{day?.off ? offLabel(day.off) : 'Можно посмотреть следующий учебный день.'}</p>
            <button className="secondary" onClick={() => onMode('next')}>
              Следующий учебный день
            </button>
          </div>
        ) : (
          <>
            {activeAlert && (
              <div className="bell-alert-banner" role="status" onClick={dismissAlert}>
                <span className="bell-alert-icon" aria-hidden="true">
                  🔔
                </span>
                <span className="bell-alert-text">
                  <strong>{activeAlert.minutes} мин до конца:</strong> {activeAlert.message}
                </span>
                <button
                  type="button"
                  className="bell-alert-close"
                  aria-label="Закрыть напоминание"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissAlert();
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {notice && <p className="widget-notice">{notice}</p>}
            {rowsOf(lessons).map((row) => {
              if (row.kind === 'gap') {
                const bell = day!.bell(row.number);
                return (
                  <div key={`gap-${row.number}`} className="widget-row gap">
                    <span className="row-num">{row.number}</span>
                    <span className="row-gap">окно</span>
                    {bell && <span className="row-time">{timeText(bell)}</span>}
                    {showRoom && <span className="row-room" />}
                  </div>
                );
              }
              const { lesson } = row;
              const time = day!.time(lesson);
              const note = day!.note(lesson.lessonNumber);
              const noteKey = `${dateKey}:${lesson.lessonNumber}`;
              const writing = editing === noteKey;
              const state =
                shown !== 'today' || !time
                  ? ''
                  : clock >= time.end
                    ? 'past'
                    : clock >= time.start
                      ? 'current'
                      : '';
              const left = timer?.lessonId === lesson.id ? timer : null;
              const edit = onNote ? () => setEditing(noteKey) : undefined;
              const colorTag = matchColorTag(lesson, data.settings.colorTags);
              return (
                <Fragment key={lesson.id}>
                  <div
                    className={`widget-row ${state} ${left?.kind === 'break' ? 'upcoming' : ''} ${edit ? 'editable' : ''}`}
                    data-color-tag={colorTag?.color}
                    aria-current={state === 'current' ? 'time' : undefined}
                    title={
                      edit ? (note ? 'Изменить заметку' : 'Добавить заметку к уроку') : undefined
                    }
                    onClick={edit}
                    // С клавиатуры — как кнопка: Tab до урока, Enter или пробел открывают заметку.
                    role={edit ? 'button' : undefined}
                    tabIndex={edit ? 0 : undefined}
                    onKeyDown={
                      edit
                        ? (e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            edit();
                          }
                        : undefined
                    }
                    style={
                      left?.kind === 'lesson'
                        ? ({ '--progress': `${left.progress * 100}%` } as CSSProperties)
                        : undefined
                    }
                  >
                    <span className="row-num">{lesson.lessonNumber}</span>
                    <strong className="row-class" title={lesson.className}>
                      {lesson.className}
                    </strong>
                    <span className="row-subject" title={showSubject ? lesson.subject : undefined}>
                      {showSubject ? lesson.subject : ''}
                    </span>
                    <span
                      className={`row-time ${left ? 'row-countdown' : ''}`}
                      title={left ? timeText(time) : undefined}
                    >
                      {left
                        ? `${left.kind === 'lesson' ? 'ещё' : 'через'} ${left.minutes} мин`
                        : timeText(time)}
                    </span>
                    {showRoom && (
                      <span className="row-room">
                        {lesson.room.trim() && `каб. ${lesson.room}`}
                      </span>
                    )}
                  </div>
                  {writing ? (
                    <NoteEditor
                      initial={note}
                      label={`Заметка к уроку ${lesson.lessonNumber}, ${lesson.className}`}
                      onDone={(text) => {
                        setEditing(null);
                        if (text !== null && text.trim() !== note)
                          onNote?.(dateKey, lesson.lessonNumber, text);
                      }}
                    />
                  ) : (
                    note &&
                    (hasChecklist(note) ? (
                      <div className={`row-note row-checklist ${state}`} title={note}>
                        <div className="checklist-items">
                          {parseChecklist(note).map((part, pIdx) => {
                            if (part.kind === 'text') {
                              return (
                                <span key={pIdx} className="checklist-text" onClick={edit}>
                                  {part.text}
                                </span>
                              );
                            }
                            return (
                              <span
                                key={pIdx}
                                className={`checklist-item ${part.done ? 'done' : ''}`}
                                role="checkbox"
                                aria-checked={part.done}
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === ' ' || e.key === 'Enter') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const updated = toggleChecklistItem(note, part.index);
                                    onNote?.(dateKey, lesson.lessonNumber, updated);
                                  }
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updated = toggleChecklistItem(note, part.index);
                                  onNote?.(dateKey, lesson.lessonNumber, updated);
                                }}
                              >
                                <span className="checklist-box" aria-hidden="true">
                                  {part.done && (
                                    <svg
                                      viewBox="0 0 12 12"
                                      width="9"
                                      height="9"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <polyline points="2.5 6 4.5 8.5 9.5 3.5" />
                                    </svg>
                                  )}
                                </span>
                                <span className="checklist-item-text">{part.text}</span>
                              </span>
                            );
                          })}
                        </div>
                        {edit && (
                          <button
                            type="button"
                            className="checklist-edit-btn"
                            title="Редактировать заметку"
                            aria-label="Редактировать заметку"
                            onClick={(e) => {
                              e.stopPropagation();
                              edit();
                            }}
                          >
                            ✎
                          </button>
                        )}
                      </div>
                    ) : (
                      <p className={`row-note ${state}`} title={note} onClick={edit}>
                        {note}
                      </p>
                    ))
                  )}
                </Fragment>
              );
            })}
          </>
        )}
      </div>
      {screen ? (
        <nav className="screen-nav" aria-label="Разделы">
          <button
            aria-pressed={!week && shown === 'today'}
            onClick={() => {
              setWeek(false);
              onMode('today');
            }}
          >
            Сегодня
          </button>
          <button
            aria-pressed={!week && shown === 'next'}
            onClick={() => {
              setWeek(false);
              onMode('next');
            }}
          >
            {nextLabel}
          </button>
          <button aria-pressed={week} onClick={() => setWeek(true)}>
            Неделя
          </button>
          <button onClick={onSettings}>Настройки</button>
        </nav>
      ) : (
        !week && (
          <div className="widget-bottom">
            {!compact && <span className="widget-meta">{meta}</span>}
            <div className="widget-switch" role="group" aria-label="Показываемый день">
              <button aria-pressed={shown === 'today'} onClick={() => onMode('today')}>
                Сегодня
              </button>
              <button aria-pressed={shown === 'next'} onClick={() => onMode('next')}>
                {nextLabel}
              </button>
            </div>
          </div>
        )
      )}
    </section>
  );
}
