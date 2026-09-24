import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  emptyData,
  gaps,
  lessonsForDay,
  timeOf,
  validate,
  weekdays,
  type AppData,
  type Lesson,
} from './domain';
import { getStorage, type Storage } from './storage';
type Props = {
  storage?: Storage;
  initialTab?: 'schedule' | 'bells';
  onDirty?: (dirty: boolean) => void;
};
export function App({ storage, initialTab = 'schedule', onDirty }: Props) {
  const [data, setData] = useState<AppData>(emptyData);
  const [saved, setSaved] = useState('');
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'schedule' | 'bells'>(initialTab);
  const [day, setDay] = useState(1);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const value = await (storage ?? (await getStorage())).load();
        if (!cancelled) {
          setData(value);
          setSaved(JSON.stringify(value));
          setReady(true);
          setFailure('');
        }
      } catch {
        if (!cancelled)
          setFailure(
            'Не удалось загрузить расписание. Данные не перезаписаны. Проверьте доступ к хранилищу и повторите попытку.',
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storage, attempt]);
  const dirty = JSON.stringify(data) !== saved;
  useEffect(() => {
    onDirty?.(ready && dirty);
  }, [ready, dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (ready && dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, ready]);
  function change(next: AppData) {
    setData(next);
    setStatus('');
  }
  function updateLesson(id: string, patch: Partial<Lesson>) {
    change({ ...data, lessons: data.lessons.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }
  async function save() {
    setBusy(true);
    setStatus('');
    try {
      await (storage ?? (await getStorage())).save(data);
      setSaved(JSON.stringify(data));
      setStatus('Изменения сохранены');
    } catch {
      setStatus('Не удалось сохранить. Изменения остались в редакторе — попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }
  const errors = validate(data);
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
            <h1>{tab === 'schedule' ? 'Недельное расписание' : 'Расписание звонков'}</h1>
            <p className="muted">
              {tab === 'schedule'
                ? 'Добавьте уроки — время подставится из расписания звонков.'
                : 'Общее время занятий для всех учебных дней.'}
            </p>
          </div>
          <span className="badge">Локально · v0.1</span>
        </header>
        {failure ? (
          <section role="alert" className="panel">
            <h2>Не удалось загрузить расписание</h2>
            <p>{failure}</p>
            <button onClick={() => setAttempt((a) => a + 1)}>Повторить</button>
          </section>
        ) : !ready ? (
          <p role="status">Загрузка расписания…</p>
        ) : (
          <>
            <fieldset disabled={busy} className="editor">
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
                    {gaps(lessons).length ? ` Окна: ${gaps(lessons).join(', ')}.` : ''}
                  </p>
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
                      onClick={() => {
                        let n = 1;
                        while (data.bells.some((b) => b.lessonNumber === n)) n++;
                        change({
                          ...data,
                          bells: [...data.bells, { lessonNumber: n, start: '', end: '' }],
                        });
                      }}
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
                  {data.bells.map((bell, i) => (
                    <div className="bell-row" key={i}>
                      <label>
                        № урока
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={bell.lessonNumber}
                          onChange={(e) =>
                            change({
                              ...data,
                              bells: data.bells.map((b, j) =>
                                j === i ? { ...b, lessonNumber: Number(e.target.value) } : b,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Начало
                        <input
                          type="time"
                          value={bell.start}
                          onChange={(e) =>
                            change({
                              ...data,
                              bells: data.bells.map((b, j) =>
                                j === i ? { ...b, start: e.target.value } : b,
                              ),
                            })
                          }
                        />
                      </label>
                      <span>—</span>
                      <label>
                        Окончание
                        <input
                          type="time"
                          value={bell.end}
                          onChange={(e) =>
                            change({
                              ...data,
                              bells: data.bells.map((b, j) =>
                                j === i ? { ...b, end: e.target.value } : b,
                              ),
                            })
                          }
                        />
                      </label>
                      <button
                        className="delete"
                        aria-label={`Удалить звонок ${bell.lessonNumber}`}
                        onClick={() =>
                          change({ ...data, bells: data.bells.filter((_, j) => i !== j) })
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </fieldset>
            {errors.length > 0 && (
              <div role="alert" className="errors">
                <strong>Перед сохранением:</strong>
                <ul>
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}
            <footer>
              <span role="status">
                {status || (dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены')}
              </span>
              <div>
                <button
                  disabled={!dirty || busy}
                  onClick={() => {
                    setData(JSON.parse(saved));
                    setStatus('Изменения отменены');
                  }}
                >
                  Отменить изменения
                </button>
                <button
                  className="primary"
                  disabled={!dirty || busy || errors.length > 0}
                  onClick={save}
                >
                  {busy ? 'Сохранение…' : 'Сохранить изменения'}
                </button>
              </div>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
