import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './icons';
import {
  isoDate,
  lessonsForDay,
  lessonColor,
  nextBell,
  publicHolidays,
  shortenBells,
  timeOf,
  weekdays,
  type AppData,
  type Lesson,
  type LessonTime,
} from './domain';
import type { Storage } from './storage';
import { useEditor } from './useEditor';
type Props = {
  storage?: Storage;
  initialTab?: Tab;
  /** Раздел задаёт окно настроек; без него редактор сам переключает разделы. */
  tab?: Tab;
  /** true, пока есть правки с ошибками: они лежат в черновике и ещё не видны в виджете. */
  onDirty?: (dirty: boolean) => void;
};
export type Tab = 'schedule' | 'bells' | 'calendar';
const titles: Record<Tab, string> = {
  schedule: 'Недельное расписание',
  bells: 'Расписание звонков',
  calendar: 'Каникулы и сокращённые дни',
};
const shortDay = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
const lessonWord = (n: number) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'урок'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? 'урока'
      : 'уроков';
const MAX_LESSONS = 20;
const mostCommon = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
};
const unique = (values: string[]) =>
  [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true }),
  );
/** Подписи столбцов таблиц: у полей они скрыты, но остаются для программ экранного чтения. */
const Caption = ({ children }: { children: string }) => <span className="ed-vh">{children}</span>;
/** Строки звонков: общие и сокращённые редактируются одинаково. */
function BellRows({
  bells,
  onChange,
  deleteLabel,
}: {
  bells: LessonTime[];
  onChange: (bells: LessonTime[]) => void;
  deleteLabel: string;
}) {
  const patch = (i: number, value: Partial<LessonTime>) =>
    onChange(bells.map((b, j) => (j === i ? { ...b, ...value } : b)));
  if (!bells.length) return null;
  return (
    <div className="ed-grid ed-bells">
      <div className="ed-grid-head" aria-hidden="true">
        <span>№</span>
        <span>Начало</span>
        <span />
        <span>Окончание</span>
        <span />
      </div>
      {bells.map((bell, i) => (
        <div className="ed-grid-row" key={i}>
          <label>
            <Caption>№ урока</Caption>
            <input
              type="number"
              min="1"
              max="20"
              value={bell.lessonNumber}
              onChange={(e) => patch(i, { lessonNumber: Number(e.target.value) })}
            />
          </label>
          <label>
            <Caption>Начало</Caption>
            <input
              type="time"
              value={bell.start}
              onChange={(e) => patch(i, { start: e.target.value })}
            />
          </label>
          <span className="ed-dash">—</span>
          <label>
            <Caption>Окончание</Caption>
            <input
              type="time"
              value={bell.end}
              onChange={(e) => patch(i, { end: e.target.value })}
            />
          </label>
          <button
            className="delete"
            aria-label={`${deleteLabel} ${bell.lessonNumber}`}
            onClick={() => onChange(bells.filter((_, j) => i !== j))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
export function App({ storage, initialTab = 'schedule', tab: controlled, onDirty }: Props) {
  const editor = useEditor(storage, onDirty);
  const { data, change, ready, failure, status, setStatus, errors, pending, failed } = editor;
  const [ownTab, setOwnTab] = useState<Tab>(initialTab);
  const tab = controlled ?? ownTab;
  const [shortLesson, setShortLesson] = useState(30);
  const [shortBreak, setShortBreak] = useState(10);
  const [day, setDay] = useState(1);
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [focusId, setFocusId] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  function updateLesson(id: string, patch: Partial<Lesson>) {
    change({ ...data, lessons: data.lessons.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }
  const lessons = lessonsForDay(data.lessons, day);
  // Новый урок получает самые частые предмет и кабинет: чаще всего они повторяются.
  const defaults = {
    subject: mostCommon(data.lessons.map((l) => l.subject.trim()).filter(Boolean)),
    room: mostCommon(data.lessons.map((l) => l.room.trim()).filter(Boolean)),
  };
  function addLesson(number?: number, weekday = day) {
    const mine = lessonsForDay(data.lessons, weekday);
    if (mine.length >= MAX_LESSONS) return;
    const used = new Set(mine.map((l) => l.lessonNumber));
    let n = number ?? 1;
    if (number === undefined) while (used.has(n)) n++;
    const id = crypto.randomUUID();
    change({
      ...data,
      lessons: [
        ...data.lessons,
        {
          id,
          weekday,
          lessonNumber: n,
          className: '',
          subject: defaults.subject,
          room: defaults.room,
        },
      ],
    });
    setFocusId(id);
  }
  // После добавления урока курсор встаёт в его поле «Класс».
  useEffect(() => {
    if (!focusId) return;
    const field = table.current?.querySelector<HTMLInputElement>(
      `[data-lesson-id="${focusId}"] input[data-field="class"]`,
    );
    if (field) {
      field.focus();
      setFocusId(null);
    }
  }, [focusId, data, mode, day]);
  /** Enter переходит к тому же полю в следующей строке, а в последней — добавляет урок. */
  function onEnter(e: KeyboardEvent<HTMLInputElement>, field: string) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const fields = [
      ...(table.current?.querySelectorAll<HTMLInputElement>(`input[data-field="${field}"]`) ?? []),
    ];
    const next = fields[fields.indexOf(e.currentTarget) + 1];
    if (next) {
      next.focus();
      next.select();
    } else addLesson();
  }
  const otherDays = weekdays
    .map((_, i) => i + 1)
    .filter((d) => d !== day && data.lessons.some((l) => l.weekday === d));
  function copyFrom(source: number) {
    const copies = data.lessons
      .filter((l) => l.weekday === source)
      .map((l) => ({ ...l, id: crypto.randomUUID(), weekday: day }));
    change({ ...data, lessons: [...data.lessons, ...copies] });
    setStatus(`Скопировано уроков: ${copies.length}`);
  }
  const classes = unique(data.lessons.map((l) => l.className));
  const subjects = unique(data.lessons.map((l) => l.subject));
  const rooms = unique(data.lessons.map((l) => l.room));
  const bellText = (n: number) => {
    const bell = data.bells.find((b) => b.lessonNumber === n);
    return bell ? `${bell.start}–${bell.end}` : '';
  };
  /** Строки дня: уроки, между ними «окна», в конце — следующий урок. Нажатие на пустую строку добавляет урок. */
  function renderRows() {
    const rows: ReactNode[] = [];
    const ghost = (n: number, label: string) => (
      <tr className="ed-ghost" key={`ghost-${n}`}>
        <td>{n}</td>
        <td>{bellText(n)}</td>
        <td colSpan={4}>
          <button
            disabled={lessons.length >= MAX_LESSONS}
            title="Enter в последней строке тоже добавляет урок"
            onClick={() => addLesson(n)}
          >
            {label}
          </button>
        </td>
      </tr>
    );
    lessons.forEach((lesson, index) => {
      const time = timeOf(lesson, data.bells);
      const color = data.settings ? lessonColor(lesson, data.settings) : undefined;
      if (index)
        for (let n = lessons[index - 1].lessonNumber + 1; n < lesson.lessonNumber; n++)
          rows.push(ghost(n, 'окно — нажмите, чтобы добавить урок'));
      rows.push(
        <tr className="ed-row" key={lesson.id} data-lesson-id={lesson.id} data-color-tag={color}>
          <td>
            <input
              aria-label={`Номер урока ${index + 1}`}
              type="number"
              min="1"
              max="20"
              value={lesson.lessonNumber}
              onChange={(e) => updateLesson(lesson.id, { lessonNumber: Number(e.target.value) })}
            />
          </td>
          <td>
            <div className="ed-time">
              <span className={lesson.customTime ? 'custom' : ''}>
                {time ? `${time.start}–${time.end}` : 'Время не задано'}
              </span>
              <button
                className="ed-icon"
                aria-label="Индивидуальное время"
                aria-pressed={!!lesson.customTime}
                title="Индивидуальное время урока"
                onClick={() =>
                  updateLesson(lesson.id, {
                    customTime: lesson.customTime
                      ? undefined
                      : { start: time?.start ?? '08:30', end: time?.end ?? '09:15' },
                  })
                }
              >
                <Icon name="clock" size={14} />
              </button>
            </div>
          </td>
          <td className="ed-classcell">
            <input
              aria-label="Класс *"
              data-field="class"
              list="ed-classes"
              placeholder="6А"
              value={lesson.className}
              onChange={(e) => updateLesson(lesson.id, { className: e.target.value })}
              onKeyDown={(e) => onEnter(e, 'class')}
            />
          </td>
          <td>
            <input
              aria-label="Предмет"
              data-field="subject"
              list="ed-subjects"
              placeholder="Необязательно"
              value={lesson.subject}
              onChange={(e) => updateLesson(lesson.id, { subject: e.target.value })}
              onKeyDown={(e) => onEnter(e, 'subject')}
            />
          </td>
          <td>
            <input
              aria-label="Кабинет"
              data-field="room"
              list="ed-rooms"
              placeholder="—"
              value={lesson.room}
              onChange={(e) => updateLesson(lesson.id, { room: e.target.value })}
              onKeyDown={(e) => onEnter(e, 'room')}
            />
          </td>
          <td>
            <button
              className="delete"
              aria-label={`Удалить урок ${lesson.lessonNumber}`}
              title="Удалить урок. Пропущенный номер покажется как окно."
              onClick={() =>
                change({ ...data, lessons: data.lessons.filter((l) => l.id !== lesson.id) })
              }
            >
              <Icon name="x" size={14} />
            </button>
          </td>
        </tr>,
      );
      if (lesson.customTime)
        rows.push(
          <tr className="ed-custom" key={`time-${lesson.id}`}>
            <td />
            <td colSpan={5}>
              <div className="ed-custom-fields">
                <label>
                  Начало
                  <input
                    type="time"
                    value={lesson.customTime.start}
                    onChange={(e) =>
                      updateLesson(lesson.id, {
                        customTime: { ...lesson.customTime!, start: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Окончание
                  <input
                    type="time"
                    value={lesson.customTime.end}
                    onChange={(e) =>
                      updateLesson(lesson.id, {
                        customTime: { ...lesson.customTime!, end: e.target.value },
                      })
                    }
                  />
                </label>
              </div>
            </td>
          </tr>,
        );
    });
    const next = lessons[lessons.length - 1].lessonNumber + 1;
    if (lessons.length < MAX_LESSONS && next <= MAX_LESSONS) rows.push(ghost(next, '+ урок'));
    return rows;
  }
  return (
    <div className="ed">
      {controlled === undefined && (
        <nav className="ed-tabs" aria-label="Настройки">
          <button
            className={tab === 'schedule' ? 'active' : ''}
            onClick={() => setOwnTab('schedule')}
          >
            ▦ &nbsp; Расписание
          </button>
          <button className={tab === 'bells' ? 'active' : ''} onClick={() => setOwnTab('bells')}>
            ◷ &nbsp; Звонки
          </button>
          <button
            className={tab === 'calendar' ? 'active' : ''}
            onClick={() => setOwnTab('calendar')}
          >
            ☼ &nbsp; Каникулы
          </button>
        </nav>
      )}
      <header className="ed-head">
        <h1>{titles[tab]}</h1>
        {tab === 'schedule' && data.lessons.length > 0 && (
          <span className="weekly-workload-chip">Всего уроков: {data.lessons.length}</span>
        )}
        {tab === 'bells' && (
          <span className="muted">Изменения применяются ко всем урокам без своего времени.</span>
        )}
        {tab === 'calendar' && (
          <span className="muted">В эти дни виджет сразу показывает следующий учебный день.</span>
        )}
      </header>
      {failure ? (
        <section role="alert" className="ed-card ed-pad">
          <h2>Не удалось загрузить расписание</h2>
          <p>{failure}</p>
          <button onClick={editor.retry}>Повторить</button>
        </section>
      ) : !ready ? (
        <p role="status" className="ed-pad">
          Загрузка расписания…
        </p>
      ) : (
        <>
          {tab === 'schedule' && (
            <div className="ed-bar">
              <div className="ed-days" role="group" aria-label="День недели">
                {weekdays.map((name, i) => (
                  <button
                    key={name}
                    title={name}
                    aria-label={`${name}, уроков: ${data.lessons.filter((l) => l.weekday === i + 1).length}`}
                    aria-pressed={mode === 'day' && day === i + 1}
                    className={mode === 'day' && day === i + 1 ? 'selected' : ''}
                    onClick={() => {
                      setDay(i + 1);
                      setMode('day');
                    }}
                  >
                    {shortDay[i]}
                    <span>{data.lessons.filter((l) => l.weekday === i + 1).length}</span>
                  </button>
                ))}
              </div>
              <div className="ed-seg" role="group" aria-label="Режим">
                <button
                  className={mode === 'day' ? 'selected' : ''}
                  aria-pressed={mode === 'day'}
                  onClick={() => setMode('day')}
                >
                  День
                </button>
                <button
                  className={mode === 'week' ? 'selected' : ''}
                  aria-pressed={mode === 'week'}
                  onClick={() => setMode('week')}
                >
                  Неделя
                </button>
              </div>
              <span className="ed-spacer" />
              {mode === 'day' && !lessons.length && otherDays.length > 0 && (
                <span className="ed-copy">
                  <Icon name="copy" size={14} />
                  <select
                    aria-label="Скопировать уроки из другого дня"
                    value=""
                    onChange={(e) => e.target.value && copyFrom(Number(e.target.value))}
                  >
                    <option value="">Скопировать день из…</option>
                    {otherDays.map((d) => (
                      <option key={d} value={d}>
                        {weekdays[d - 1]}
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </div>
          )}
          <div className="ed-body">
            {tab === 'schedule' ? (
              mode === 'week' ? (
                <WeekGrid
                  data={data}
                  onOpen={(weekday, id) => {
                    setDay(weekday);
                    setMode('day');
                    setFocusId(id);
                  }}
                  onAdd={(weekday, number) => {
                    setDay(weekday);
                    setMode('day');
                    addLesson(number, weekday);
                  }}
                />
              ) : !lessons.length ? (
                <div className="empty">
                  <span>▦</span>
                  <h3>Здесь будет расписание</h3>
                  <p>
                    Добавьте первый урок на{' '}
                    {['понедельник', 'вторник', 'среду', 'четверг', 'пятницу'][day - 1]}.
                    <br />
                    Дни без уроков будут пропущены при поиске следующего учебного дня.
                  </p>
                  <button className="secondary" onClick={() => addLesson()}>
                    + Добавить урок
                  </button>
                </div>
              ) : (
                <>
                  <table className="ed-table" ref={table}>
                    <colgroup>
                      <col className="c-n" />
                      <col className="c-time" />
                      <col className="c-class" />
                      <col />
                      <col className="c-room" />
                      <col className="c-del" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>№</th>
                        <th>Время</th>
                        <th>Класс</th>
                        <th>Предмет</th>
                        <th>Каб.</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>{renderRows()}</tbody>
                  </table>
                  <datalist id="ed-classes">
                    {classes.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                  <datalist id="ed-subjects">
                    {subjects.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                  <datalist id="ed-rooms">
                    {rooms.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                </>
              )
            ) : tab === 'calendar' ? (
              <>
                <section className="ed-card">
                  <div className="ed-card-head">
                    <div>
                      <h2>Каникулы и праздники</h2>
                      <p className="muted">
                        В эти дни уроков нет: виджет сразу покажет следующий учебный день.
                      </p>
                    </div>
                    <div className="ed-actions">
                      <button
                        className="secondary"
                        title="4 ноября, новогодние праздники, 23 февраля, 8 марта, 1 и 9 мая"
                        onClick={() => {
                          const known = new Set(data.holidays.map((h) => h.start));
                          const added = publicHolidays(new Date())
                            .filter((h) => !known.has(h.start))
                            .map((h) => ({ ...h, id: crypto.randomUUID() }));
                          change({ ...data, holidays: [...data.holidays, ...added] });
                          setStatus(
                            added.length
                              ? `Добавлено праздников: ${added.length}`
                              : 'Праздники этого учебного года уже в списке',
                          );
                        }}
                      >
                        + Праздники учебного года
                      </button>
                      <button
                        className="secondary"
                        disabled={data.holidays.length >= 100}
                        onClick={() => {
                          const today = isoDate(new Date());
                          change({
                            ...data,
                            holidays: [
                              ...data.holidays,
                              { id: crypto.randomUUID(), title: '', start: today, end: today },
                            ],
                          });
                        }}
                      >
                        + Добавить период
                      </button>
                    </div>
                  </div>
                  {!data.holidays.length && (
                    <div className="empty small">
                      <h3>Каникул пока нет</h3>
                      <p>
                        Добавьте осенние, зимние и весенние каникулы — даты есть на сайте школы.
                      </p>
                    </div>
                  )}
                  {data.holidays.length > 0 && (
                    <div className="ed-grid ed-holidays">
                      <div className="ed-grid-head" aria-hidden="true">
                        <span>Название</span>
                        <span>С</span>
                        <span>По</span>
                        <span />
                      </div>
                      {data.holidays.map((h) => {
                        const patch = (value: Partial<typeof h>) =>
                          change({
                            ...data,
                            holidays: data.holidays.map((x) =>
                              x.id === h.id ? { ...x, ...value } : x,
                            ),
                          });
                        return (
                          <div className="ed-grid-row" key={h.id}>
                            <label>
                              <Caption>Название</Caption>
                              <input
                                placeholder="Например, осенние каникулы"
                                maxLength={100}
                                value={h.title}
                                onChange={(e) => patch({ title: e.target.value })}
                              />
                            </label>
                            <label>
                              <Caption>С</Caption>
                              <input
                                type="date"
                                value={h.start}
                                onChange={(e) =>
                                  // Начало позже конца — сдвигаем и конец: чаще всего это один день.
                                  patch({
                                    start: e.target.value,
                                    ...(e.target.value > h.end ? { end: e.target.value } : {}),
                                  })
                                }
                              />
                            </label>
                            <label>
                              <Caption>По</Caption>
                              <input
                                type="date"
                                value={h.end}
                                onChange={(e) => patch({ end: e.target.value })}
                              />
                            </label>
                            <button
                              className="delete"
                              aria-label={`Удалить период ${h.title || h.start}`}
                              onClick={() =>
                                change({
                                  ...data,
                                  holidays: data.holidays.filter((x) => x.id !== h.id),
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="hint">
                    Для одного дня укажите одинаковые даты. Переносы выходных каждый год свои —
                    добавьте их сами.
                  </p>
                </section>
                <section className="ed-card">
                  <div className="ed-card-head">
                    <div>
                      <h2>Сокращённые дни</h2>
                      <p className="muted">
                        В эти даты время уроков берётся из сокращённых звонков — и отсчёт на виджете
                        тоже.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      disabled={data.shortDays.length >= 200}
                      onClick={() => {
                        const date = new Date();
                        while (data.shortDays.includes(isoDate(date)))
                          date.setDate(date.getDate() + 1);
                        change({ ...data, shortDays: [...data.shortDays, isoDate(date)] });
                      }}
                    >
                      + Добавить дату
                    </button>
                  </div>
                  {data.shortDays.length > 0 && (
                    <div className="ed-grid ed-shortdays">
                      {data.shortDays.map((date, i) => (
                        <div className="ed-grid-row" key={i}>
                          <label>
                            <Caption>Дата</Caption>
                            <input
                              type="date"
                              value={date}
                              onChange={(e) =>
                                change({
                                  ...data,
                                  shortDays: data.shortDays.map((d, j) =>
                                    j === i ? e.target.value : d,
                                  ),
                                })
                              }
                            />
                          </label>
                          <button
                            className="delete"
                            aria-label={`Удалить сокращённый день ${date}`}
                            onClick={() =>
                              change({
                                ...data,
                                shortDays: data.shortDays.filter((_, j) => j !== i),
                              })
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section className="ed-card">
                  <div className="ed-card-head">
                    <div>
                      <h2>Сокращённые звонки</h2>
                      <p className="muted">
                        Заменяют обычное и индивидуальное время уроков с теми же номерами.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      disabled={data.shortBells.length >= 20}
                      onClick={() =>
                        change({
                          ...data,
                          shortBells: [...data.shortBells, nextBell(data.shortBells)],
                        })
                      }
                    >
                      + Добавить звонок
                    </button>
                  </div>
                  <div className="ed-shorten">
                    <label>
                      Уроки по, мин
                      <input
                        type="number"
                        min="10"
                        max="45"
                        value={shortLesson}
                        onChange={(e) => setShortLesson(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Перемены по, мин
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={shortBreak}
                        onChange={(e) => setShortBreak(Number(e.target.value))}
                      />
                    </label>
                    <button
                      disabled={
                        !data.bells.length ||
                        !(shortLesson >= 10 && shortLesson <= 45) ||
                        !(shortBreak >= 0 && shortBreak <= 30)
                      }
                      title={
                        data.bells.length
                          ? 'Первый урок начнётся как обычно, дальше — уроки и перемены заданной длины'
                          : 'Сначала заполните обычные звонки'
                      }
                      onClick={() =>
                        change({
                          ...data,
                          shortBells: shortenBells(data.bells, shortLesson, shortBreak),
                        })
                      }
                    >
                      Рассчитать от обычных звонков
                    </button>
                  </div>
                  <BellRows
                    bells={data.shortBells}
                    deleteLabel="Удалить сокращённый звонок"
                    onChange={(shortBells) => change({ ...data, shortBells })}
                  />
                  {data.shortDays.length > 0 && !data.shortBells.length && (
                    <p className="hint">
                      Пока сокращённые звонки не заданы, в эти дни действует обычное время.
                    </p>
                  )}
                </section>
              </>
            ) : (
              <section className="ed-card">
                <div className="ed-card-head">
                  <div>
                    <h2>Время занятий</h2>
                    <p className="muted">
                      Изменения применяются ко всем урокам без индивидуального времени.
                    </p>
                  </div>
                  <button
                    className="secondary"
                    disabled={data.bells.length >= 20}
                    onClick={() =>
                      change({ ...data, bells: [...data.bells, nextBell(data.bells)] })
                    }
                  >
                    + Добавить звонок
                  </button>
                </div>
                {!data.bells.length && (
                  <div className="empty small">
                    <h3>Добавьте время первого урока</h3>
                    <p>Можно сначала заполнить классы, а звонки настроить позже.</p>
                  </div>
                )}
                <BellRows
                  bells={data.bells}
                  deleteLabel="Удалить звонок"
                  onChange={(bells) => change({ ...data, bells })}
                />
              </section>
            )}
            {errors.length > 0 && (
              <div role="alert" className="errors">
                <strong>Исправьте, чтобы изменения появились в виджете:</strong>
                <ul>
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="ed-foot">
            <span className="ed-count">
              {tab === 'schedule' &&
                `Неделя: ${data.lessons.length} ${lessonWord(data.lessons.length)}`}
            </span>
            <span role="status">{status || (pending ? 'Сохранение…' : 'Сохранено')}</span>
            <div>
              {failed && <button onClick={editor.flush}>Повторить сохранение</button>}
              <button
                disabled={!editor.changed}
                title="Вернуть расписание, каким оно было при открытии редактора"
                onClick={editor.revert}
              >
                Отменить изменения
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
/** Неделя целиком: уроки по дням и номерам. Нажатие открывает урок, пустая клетка добавляет его. */
function WeekGrid({
  data,
  onOpen,
  onAdd,
}: {
  data: AppData;
  onOpen: (weekday: number, id: string) => void;
  onAdd: (weekday: number, number: number) => void;
}) {
  const last = Math.max(
    6,
    ...data.lessons.map((l) => l.lessonNumber),
    ...data.bells.map((b) => b.lessonNumber),
  );
  const numbers = Array.from({ length: Math.min(last, 12) }, (_, i) => i + 1);
  return (
    <table className="ed-week">
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
                const lesson = data.lessons.find(
                  (l) => l.weekday === i + 1 && l.lessonNumber === n,
                );
                if (!lesson)
                  return (
                    <td key={name}>
                      <button
                        className="ed-cell blank"
                        aria-label={`Добавить урок ${n}, ${name}`}
                        onClick={() => onAdd(i + 1, n)}
                      >
                        +
                      </button>
                    </td>
                  );
                return (
                  <td key={name}>
                    <button
                      className="ed-cell"
                      data-color-tag={
                        data.settings ? lessonColor(lesson, data.settings) : undefined
                      }
                      title={`${name}, урок ${n}`}
                      onClick={() => onOpen(i + 1, lesson.id)}
                    >
                      <b>{lesson.className || '—'}</b>
                      <span>
                        {[lesson.subject, lesson.room && `каб. ${lesson.room}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </button>
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
