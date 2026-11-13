import { useState } from 'react';
import { classWeek, timeOf, weekdays, type AppData, type Lesson } from './domain';

const shortDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];

/**
 * Школьный режим: неделя своего класса из расписания школы — только для чтения.
 * Вводить уроки класса вручную не нужно: их присылает завуч, замены учтены в тексте для родителей.
 */
export function SchoolClassView({ data, mobile }: { data: AppData; mobile: boolean }) {
  const className = data.homeroom?.className.trim() ?? '';
  const week = classWeek(data);
  const [day, setDay] = useState(() => {
    const d = new Date().getDay();
    return d >= 1 && d <= 5 ? d : 1;
  });
  const time = (n: number) => timeOf({ lessonNumber: n } as Lesson, data.bells);
  const note = (
    <p className="muted school-class-note">
      Расписание {className} приходит из школы — вводить уроки не нужно. Замены на конкретные дни
      учтены в тексте для родителей.
    </p>
  );

  if (mobile) {
    const lessons = week
      .filter((l) => l.weekday === day)
      .sort((a, b) => a.lessonNumber - b.lessonNumber);
    return (
      <>
        {note}
        <div className="m-days" role="tablist" aria-label="День недели">
          {shortDays.map((name, i) => {
            const count = week.filter((l) => l.weekday === i + 1).length;
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
        <div className="m-list">
          {lessons.length ? (
            lessons.map((l) => {
              const t = time(l.lessonNumber);
              return (
                <div key={l.id} className={`m-row school-class-row ${l.mine ? 'm-row-mine' : ''}`}>
                  <span className="m-num">{l.lessonNumber}</span>
                  <span className="m-row-main">
                    <strong>{l.subject}</strong>
                    <small>
                      {[l.mine ? 'ваш урок' : l.teacher, l.room && `каб. ${l.room}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </span>
                  {t && (
                    <span className="m-row-time">
                      {t.start}
                      <small>{t.end}</small>
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <div className="m-empty">
              <h2>У {className} в этот день уроков нет</h2>
            </div>
          )}
        </div>
      </>
    );
  }

  const numbers = [...new Set(week.map((l) => l.lessonNumber))].sort((a, b) => a - b);
  return (
    <section className="ed-card">
      <div className="ed-card-head">
        <div>
          <h2>Уроки {className}</h2>
          {note}
        </div>
      </div>
      <table className="ed-week hr-week school-class-week">
        <thead>
          <tr>
            <th>
              <span className="ed-vh">Урок</span>
            </th>
            {shortDays.map((d, i) => (
              <th key={d} title={weekdays[i]}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {numbers.map((n) => (
            <tr key={n}>
              <th>
                {n}
                {time(n) && <small className="muted"> {time(n)!.start}</small>}
              </th>
              {[1, 2, 3, 4, 5].map((wd) => {
                const l = week.find((x) => x.weekday === wd && x.lessonNumber === n);
                return (
                  <td key={wd} className={l?.mine ? 'mine' : ''}>
                    {l && (
                      <>
                        <strong>{l.subject}</strong>
                        <small className="muted">
                          {[l.room && `каб. ${l.room}`, l.mine ? 'ваш урок' : l.teacher]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
