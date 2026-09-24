import type { CSSProperties } from 'react';
import { getNextSchoolDay, lessonsForDay, timeOf, type AppData } from './domain';
import { lessonCount } from './calendar';
import { useToday } from './hooks';
type Props = {
  data: AppData;
  mode: 'today' | 'next';
  onMode: (mode: 'today' | 'next') => void;
  onSettings: () => void;
  onClose: () => void;
  onLock: () => void;
  onDrag: () => void;
};
export function Widget({ data, mode, onMode, onSettings, onClose, onLock, onDrag }: Props) {
  const now = useToday();
  const date = mode === 'today' ? now : getNextSchoolDay(data.lessons, now);
  const lessons = date ? lessonsForDay(data.lessons, date.getDay()) : [];
  const compact = data.settings.widgetSize === 'compact';
  return (
    <section
      className={`schedule-widget ${compact ? 'compact' : ''}`}
      style={{ '--widget-alpha': data.settings.opacity / 100 } as CSSProperties}
      aria-label="Виджет расписания"
    >
      <div
        className={`widget-top ${data.settings.locked ? 'locked' : ''}`}
        onPointerDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest('button')) onDrag();
        }}
      >
        <span className="widget-brand">У &nbsp; ПОМОЩНИК УЧИТЕЛЯ</span>
        <div className="widget-actions">
          <button
            aria-label={data.settings.locked ? 'Открепить виджет' : 'Закрепить виджет'}
            aria-pressed={data.settings.locked}
            onClick={onLock}
          >
            {data.settings.locked ? '◆' : '◇'}
          </button>
          <button aria-label="Открыть настройки" onClick={onSettings}>
            ⚙
          </button>
          <button aria-label="Закрыть виджет" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="widget-heading">
        <p className="eyebrow">{mode === 'today' ? 'СЕГОДНЯ' : 'СЛЕДУЮЩИЙ УЧЕБНЫЙ ДЕНЬ'}</p>
        <h1>
          {date
            ? new Intl.DateTimeFormat('ru', { weekday: 'long' }).format(date)
            : 'Расписание пока пустое'}
        </h1>
        {date && (
          <p className="widget-date">
            {new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' }).format(date)}
          </p>
        )}
      </div>
      <div className="widget-lessons">
        {!lessons.length ? (
          <div className="widget-empty">
            <span>☀</span>
            <h2>{mode === 'today' ? 'Сегодня занятий нет' : 'Добавьте первые уроки'}</h2>
            <p>
              {mode === 'today'
                ? 'Можно посмотреть следующий учебный день.'
                : 'Заполните неделю, и расписание всегда будет рядом.'}
            </p>
            <button
              className="secondary"
              onClick={mode === 'today' ? () => onMode('next') : onSettings}
            >
              {mode === 'today' ? 'Следующий учебный день' : 'Настроить расписание'}
            </button>
          </div>
        ) : (
          lessons.map((lesson, i) => {
            const time = timeOf(lesson, data.bells);
            const missing = i ? lesson.lessonNumber - lessons[i - 1].lessonNumber - 1 : 0;
            return (
              <div key={lesson.id}>
                {missing > 0 && <div className="widget-gap">Окно · {lessonCount(missing)}</div>}
                <article className="widget-lesson">
                  <span className="lesson-number">{lesson.lessonNumber}</span>
                  <div className="widget-lesson-main">
                    <strong>{lesson.className}</strong>
                    {!compact && lesson.subject && <small>{lesson.subject}</small>}
                  </div>
                  {!compact && (
                    <div className="widget-lesson-meta">
                      <span>{time ? time.start : 'Время не задано'}</span>
                      {time && <small>до {time.end}</small>}
                      {lesson.room && <small>каб. {lesson.room}</small>}
                    </div>
                  )}
                </article>
              </div>
            );
          })
        )}
      </div>
      <div className="widget-bottom">
        <span>{lessonCount(lessons.length)}</span>
        <span>{data.settings.locked ? 'Закреплён' : 'Можно перемещать'}</span>
      </div>
      <div className="widget-switch" role="group" aria-label="Показываемый день">
        <button aria-pressed={mode === 'today'} onClick={() => onMode('today')}>
          Сегодня
        </button>
        <button aria-pressed={mode === 'next'} onClick={() => onMode('next')}>
          Следующий день
        </button>
      </div>
    </section>
  );
}
