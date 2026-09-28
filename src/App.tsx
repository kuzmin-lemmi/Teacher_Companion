import { useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  gaps,
  isoDate,
  lessonsForDay,
  nextBell,
  publicHolidays,
  shortenBells,
  timeOf,
  weekdays,
  type Lesson,
  type LessonTime,
} from './domain';
import type { Storage } from './storage';
import { useEditor } from './useEditor';
import { appVersion } from './version';
type Props = {
  storage?: Storage;
  initialTab?: Tab;
  /** true, пока есть правки с ошибками: они лежат в черновике и ещё не видны в виджете. */
  onDirty?: (dirty: boolean) => void;
};
type Tab = 'schedule' | 'bells' | 'calendar';
const titles: Record<Tab, [string, string]> = {
  schedule: ['Недельное расписание', 'Добавьте уроки — время подставится из расписания звонков.'],
  bells: ['Расписание звонков', 'Общее время занятий для всех учебных дней.'],
  calendar: [
    'Каникулы и сокращённые дни',
    'Дни без уроков и дни с укороченными уроками — виджет учтёт их сам.',
  ],
};
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
  return bells.map((bell, i) => (
    <div className="bell-row" key={i}>
      <label>
        № урока
        <input
          type="number"
          min="1"
          max="20"
          value={bell.lessonNumber}
          onChange={(e) => patch(i, { lessonNumber: Number(e.target.value) })}
        />
      </label>
      <label>
        Начало
        <input
          type="time"
          value={bell.start}
          onChange={(e) => patch(i, { start: e.target.value })}
        />
      </label>
      <span>—</span>
      <label>
        Окончание
        <input type="time" value={bell.end} onChange={(e) => patch(i, { end: e.target.value })} />
      </label>
      <button
        className="delete"
        aria-label={`${deleteLabel} ${bell.lessonNumber}`}
        onClick={() => onChange(bells.filter((_, j) => i !== j))}
      >
        ×
      </button>
    </div>
  ));
}
export function App({ storage, initialTab = 'schedule', onDirty }: Props) {
  const editor = useEditor(storage, onDirty);
  const { data, change, ready, failure, status, setStatus, errors, pending, failed } = editor;
  const [tab, setTab] = useState<Tab>(initialTab);
  const [shortLesson, setShortLesson] = useState(30);
  const [shortBreak, setShortBreak] = useState(10);
  const [day, setDay] = useState(1);
  function updateLesson(id: string, patch: Partial<Lesson>) {
    change({ ...data, lessons: data.lessons.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }
  const lessons = lessonsForDay(data.lessons, day);
  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <span className="brand-icon">У</span>
          <div>
            Помощник учителя<small>Ваше расписание под рукой</small>
          </div>
        </div>
        <p className="eyebrow">НАСТРОЙКИ</p>
        <nav aria-label="Настройки">
          <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>
            ▦ &nbsp; Расписание
          </button>
          <button className={tab === 'bells' ? 'active' : ''} onClick={() => setTab('bells')}>
            ◷ &nbsp; Звонки
          </button>
          <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>
            ☼ &nbsp; Каникулы
          </button>
        </nav>
        <div className="local-note">
          <span className="dot" />{' '}
          {isTauri() ? 'Данные на этом компьютере' : 'Предпросмотр в браузере'}
          <small>
            {isTauri()
              ? 'Работает без интернета'
              : 'Данные браузера хранятся отдельно от приложения'}
          </small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">TEACHER COMPANION</p>
            <h1>{titles[tab][0]}</h1>
            <p className="muted">{titles[tab][1]}</p>
          </div>
          <span className="badge">Локально · v{appVersion}</span>
        </header>
        {failure ? (
          <section role="alert" className="panel">
            <h2>Не удалось загрузить расписание</h2>
            <p>{failure}</p>
            <button onClick={editor.retry}>Повторить</button>
          </section>
        ) : !ready ? (
          <p role="status">Загрузка расписания…</p>
        ) : (
          <>
            <fieldset className="editor">
              {tab === 'schedule' ? (
                <>
                  <div className="days" role="group" aria-label="День недели">
                    {weekdays.map((name, i) => (
                      <button
                        key={name}
                        className={day === i + 1 ? 'selected' : ''}
                        onClick={() => setDay(i + 1)}
                      >
                        {name}
                        <span>{data.lessons.filter((l) => l.weekday === i + 1).length}</span>
                      </button>
                    ))}
                  </div>
                  <section className="panel">
                    <div className="section-title">
                      <div>
                        <h2>{weekdays[day - 1]}</h2>
                        <p className="muted">
                          {lessons.length
                            ? `Уроков: ${lessons.length}`
                            : 'Занятия пока не добавлены'}
                        </p>
                      </div>
                      <button
                        className="secondary"
                        disabled={lessons.length >= 20}
                        onClick={() => {
                          const used = new Set(lessons.map((l) => l.lessonNumber));
                          let n = 1;
                          while (used.has(n)) n++;
                          change({
                            ...data,
                            lessons: [
                              ...data.lessons,
                              {
                                id: crypto.randomUUID(),
                                weekday: day,
                                lessonNumber: n,
                                className: '',
                                subject: '',
                                room: '',
                              },
                            ],
                          });
                        }}
                      >
                        + Добавить урок
                      </button>
                    </div>
                    {!lessons.length ? (
                      <div className="empty">
                        <span>▦</span>
                        <h3>Здесь будет расписание</h3>
                        <p>
                          Добавьте первый урок на{' '}
                          {['понедельник', 'вторник', 'среду', 'четверг', 'пятницу'][day - 1]}.
                          <br />
                          Дни без уроков будут пропущены при поиске следующего учебного дня.
                        </p>
                      </div>
                    ) : (
                      <div className="lesson-list">
                        {lessons.map((lesson, index) => {
                          const time = timeOf(lesson, data.bells);
                          const missing = index
                            ? lesson.lessonNumber - lessons[index - 1].lessonNumber - 1
                            : 0;
                          return (
                            <div key={lesson.id}>
                              {missing > 0 && (
                                <div className="gap">Окно · пропущено номеров: {missing}</div>
                              )}
                              <article className="lesson-card">
                                <div className="lesson-fields">
                                  <label>
                                    № урока
                                    <input
                                      aria-label={`Номер урока ${index + 1}`}
                                      type="number"
                                      min="1"
                                      max="20"
                                      value={lesson.lessonNumber}
                                      onChange={(e) =>
                                        updateLesson(lesson.id, {
                                          lessonNumber: Number(e.target.value),
                                        })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Класс *
                                    <input
                                      placeholder="Например, 6А"
                                      value={lesson.className}
                                      onChange={(e) =>
                                        updateLesson(lesson.id, { className: e.target.value })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Предмет
                                    <input
                                      placeholder="Необязательно"
                                      value={lesson.subject}
                                      onChange={(e) =>
                                        updateLesson(lesson.id, { subject: e.target.value })
                                      }
                                    />
                                  </label>
                                  <label>
                                    Кабинет
                                    <input
                                      placeholder="—"
                                      value={lesson.room}
                                      onChange={(e) =>
                                        updateLesson(lesson.id, { room: e.target.value })
                                      }
                                    />
                                  </label>
                                  <button
                                    className="delete"
                                    aria-label={`Удалить урок ${lesson.lessonNumber}`}
                                    title="Удалить урок. Пропущенный номер покажется как окно."
                                    onClick={() =>
                                      change({
                                        ...data,
                                        lessons: data.lessons.filter((l) => l.id !== lesson.id),
                                      })
                                    }
                                  >
                                    ×
                                  </button>
                                </div>
                                <div className="time-row">
                                  <span>
                                    {time ? `${time.start} — ${time.end}` : 'Время не задано'}
                                  </span>
                                  <label className="checkbox">
                                    <input
                                      type="checkbox"
                                      checked={!!lesson.customTime}
                                      onChange={(e) =>
                                        updateLesson(lesson.id, {
                                          customTime: e.target.checked
                                            ? {
                                                start: time?.start ?? '08:30',
                                                end: time?.end ?? '09:15',
                                              }
                                            : undefined,
                                        })
                                      }
                                    />
                                    Индивидуальное время
                                  </label>
                                  {lesson.customTime && (
                                    <>
                                      <label>
                                        Начало
                                        <input
                                          type="time"
                                          value={lesson.customTime.start}
                                          onChange={(e) =>
                                            updateLesson(lesson.id, {
                                              customTime: {
                                                ...lesson.customTime!,
                                                start: e.target.value,
                                              },
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
                                              customTime: {
                                                ...lesson.customTime!,
                                                end: e.target.value,
                                              },
                                            })
                                          }
                                        />
                                      </label>
                                    </>
                                  )}
                                </div>
                              </article>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                  <p className="hint">
                    Суббота и воскресенье — выходные. Порядок занятий определяется номером урока.
                    Чтобы сделать окно, просто не добавляйте урок с этим номером.
                    {gaps(lessons).length ? ` Окна: ${gaps(lessons).join(', ')}.` : ''}
                  </p>
                </>
              ) : tab === 'calendar' ? (
                <>
                  <section className="panel">
                    <div className="section-title">
                      <div>
                        <h2>Каникулы и праздники</h2>
                        <p className="muted">
                          В эти дни уроков нет: виджет сразу покажет следующий учебный день.
                        </p>
                      </div>
                      <div className="section-actions">
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
                      <div className="empty">
                        <h3>Каникул пока нет</h3>
                        <p>
                          Добавьте осенние, зимние и весенние каникулы — даты есть на сайте школы.
                        </p>
                      </div>
                    )}
                    {data.holidays.map((h) => {
                      const patch = (value: Partial<typeof h>) =>
                        change({
                          ...data,
                          holidays: data.holidays.map((x) =>
                            x.id === h.id ? { ...x, ...value } : x,
                          ),
                        });
                      return (
                        <div className="bell-row holiday-row" key={h.id}>
                          <label>
                            Название
                            <input
                              placeholder="Например, осенние каникулы"
                              maxLength={100}
                              value={h.title}
                              onChange={(e) => patch({ title: e.target.value })}
                            />
                          </label>
                          <label>
                            С
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
                            По
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
                    <p className="hint">
                      Для одного дня укажите одинаковые даты. Переносы выходных каждый год свои —
                      добавьте их сами.
                    </p>
                  </section>
                  <section className="panel">
                    <div className="section-title">
                      <div>
                        <h2>Сокращённые дни</h2>
                        <p className="muted">
                          В эти даты время уроков берётся из сокращённых звонков — и отсчёт на
                          виджете тоже.
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
                      <div className="short-days">
                        {data.shortDays.map((date, i) => (
                          <div className="bell-row" key={i}>
                            <label>
                              Дата
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
                    <div className="section-title short-bells-title">
                      <div>
                        <h3>Сокращённые звонки</h3>
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
                    <div className="shorten-tool">
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
                <section className="panel">
                  <div className="section-title">
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
                    <div className="empty">
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
            </fieldset>
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
            <footer>
              <span role="status">
                {status || (pending ? 'Сохранение…' : 'Все изменения сохраняются автоматически')}
              </span>
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
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
