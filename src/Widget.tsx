import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  autoDayMode,
  getNextSchoolDay,
  lessonsForDay,
  timeOf,
  type AppData,
  type DayMode,
  type Lesson,
  weekdays,
} from './domain';
import { lessonCount } from './calendar';
import { useClock } from './hooks';
type Props = {
  data: AppData;
  /** `auto` — сегодня до конца последнего урока, потом следующий учебный день. */
  mode: DayMode | 'auto';
  onMode: (mode: DayMode) => void;
  onSettings: () => void;
  onClose: () => void;
  onLock: () => void;
  onDrag: () => void;
  /** Естественная высота виджета в CSS-пикселях — по ней подгоняется окно. */
  onMeasure?: (height: number) => void;
};
type Row = { kind: 'lesson'; lesson: Lesson } | { kind: 'gap'; number: number };
const weekdayName = new Intl.DateTimeFormat('ru', { weekday: 'long' });
const dayMonth = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
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
                return (
                  <td
                    key={d}
                    className={today === i + 1 ? 'today' : ''}
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
  onClose,
  onLock,
  onDrag,
  onMeasure,
}: Props) {
  const now = useClock();
  const [week, setWeek] = useState(false);
  const next = getNextSchoolDay(data.lessons, now);
  const shown = mode === 'auto' ? autoDayMode(data, now) : mode;
  const date = shown === 'today' ? now : next;
  const lessons = date ? lessonsForDay(data.lessons, date.getDay()) : [];
  const compact = data.settings.widgetSize === 'compact';
  const { locked } = data.settings;
  const subject = shared(lessons.map((l) => l.subject));
  const room = shared(lessons.map((l) => l.room));
  const showSubject = !compact && !subject && lessons.some((l) => l.subject.trim());
  const showRoom = !compact && !room && lessons.some((l) => l.room.trim());
  const clock = now.toTimeString().slice(0, 5);
  const nextLabel = !next
    ? 'Следующий'
    : isNextDay(now, next)
      ? 'Завтра'
      : capitalize(weekdayName.format(next));
  const subtitle =
    shown === 'today'
      ? `Сегодня, ${dayMonth.format(now)}`
      : date
        ? `${isNextDay(now, date) ? 'Завтра, ' : ''}${dayMonth.format(date)}`
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
      className={`schedule-widget ${compact ? 'compact' : ''}`}
      style={{ '--widget-alpha': data.settings.opacity / 100 } as CSSProperties}
      aria-label="Виджет расписания"
    >
      <div
        className={`widget-top ${locked ? 'locked' : ''}`}
        onPointerDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) onDrag();
        }}
      >
        <div className="widget-title">
          <h1>{week ? 'Неделя' : date ? capitalize(weekdayName.format(date)) : 'Расписание'}</h1>
          <p>{week ? `Пн–Пт · ${lessonCount(data.lessons.length)}` : subtitle}</p>
        </div>
        {week ? (
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
            <button aria-label="Открыть настройки" title="Настройки" onClick={onSettings}>
              {gearIcon}
            </button>
            <button aria-label="Закрыть виджет" title="Скрыть" onClick={onClose}>
              {closeIcon}
            </button>
          </div>
        )}
      </div>
      <div ref={list} className="widget-lessons">
        {week ? (
          <WeekTable data={data} today={now.getDay()} compact={compact} />
        ) : !lessons.length ? (
          <div className="widget-empty">
            <h2>{shown === 'today' ? 'Сегодня занятий нет' : 'Добавьте первые уроки'}</h2>
            <p>
              {shown === 'today'
                ? 'Можно посмотреть следующий учебный день.'
                : 'Заполните неделю — расписание всегда будет под рукой.'}
            </p>
            <button
              className="secondary"
              onClick={shown === 'today' ? () => onMode('next') : onSettings}
            >
              {shown === 'today' ? 'Следующий учебный день' : 'Настроить расписание'}
            </button>
          </div>
        ) : (
          rowsOf(lessons).map((row) => {
            if (row.kind === 'gap') {
              const bell = data.bells.find((b) => b.lessonNumber === row.number);
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
            const time = timeOf(lesson, data.bells);
            const state =
              shown !== 'today' || !time
                ? ''
                : clock >= time.end
                  ? 'past'
                  : clock >= time.start
                    ? 'current'
                    : '';
            return (
              <div
                key={lesson.id}
                className={`widget-row ${state}`}
                aria-current={state === 'current' ? 'time' : undefined}
              >
                <span className="row-num">{lesson.lessonNumber}</span>
                <strong className="row-class" title={lesson.className}>
                  {lesson.className}
                </strong>
                <span className="row-subject" title={showSubject ? lesson.subject : undefined}>
                  {showSubject ? lesson.subject : ''}
                </span>
                <span className="row-time">{timeText(time)}</span>
                {showRoom && (
                  <span className="row-room">{lesson.room.trim() && `каб. ${lesson.room}`}</span>
                )}
              </div>
            );
          })
        )}
      </div>
      {!week && (
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
      )}
    </section>
  );
}
