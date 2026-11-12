import { useEffect, useMemo, useState } from 'react';
import {
  classDay,
  classDayText,
  classWeekText,
  dayLabel,
  homeroomName,
  nextClassDay,
  shareWeekStart,
  type ClassTextOptions,
} from './classText';
import type { AppData } from './domain';
import { shareText } from './phone';

type Which = 'today' | 'next' | 'week';
const PREF_KEY = 'teacher-companion-class-share';

function loadOptions(): ClassTextOptions {
  try {
    return { rooms: true, teachers: false, ...JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') };
  } catch {
    return { rooms: true, teachers: false };
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

/**
 * «Родителям»: расписание своего класса текстом — на сегодня, на следующий учебный день или на неделю.
 * Текст можно поправить перед отправкой; правка не сохраняется.
 */
export function ClassShare({
  data,
  mobile,
  now = new Date(),
}: {
  data: AppData;
  mobile: boolean;
  now?: Date;
}) {
  const name = homeroomName(data);
  const todayHas = classDay(data, now).lines.length > 0;
  const next = nextClassDay(data, now);
  const [which, setWhich] = useState<Which>(todayHas && now.getHours() < 12 ? 'today' : 'next');
  const [opts, setOpts] = useState<ClassTextOptions>(loadOptions);
  const [status, setStatus] = useState('');
  const setOpt = (patch: Partial<ClassTextOptions>) => {
    const o = { ...opts, ...patch };
    setOpts(o);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(o));
    } catch {
      /* настройка — только удобство */
    }
  };
  const weekStart = shareWeekStart(now);
  const generated = useMemo(() => {
    if (which === 'week') return classWeekText(data, weekStart, opts);
    const date = which === 'today' ? now : next;
    return date
      ? classDayText(data, date, opts)
      : `📅 ${name}\n\nВ ближайшие три недели уроков нет`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, which, opts, next?.getTime(), weekStart.getTime()]);
  const [text, setText] = useState(generated);
  useEffect(() => {
    setText(generated);
    setStatus('');
  }, [generated]);
  if (!name) return null;

  const tabs: [Which, string][] = [
    ['today', 'Сегодня'],
    ['next', next ? cap(dayLabel(next).split(',')[0]) : 'Следующий день'],
    ['week', 'Неделя'],
  ];
  return (
    <section className={mobile ? 'm-class-share' : 'ed-card class-share'}>
      <div className="cs-head">
        <h2>Расписание {name} для родителей</h2>
        <p className="muted">
          Текст для чата родителей или учеников. Можно поправить перед отправкой.
        </p>
      </div>
      <div className="cs-tabs" role="group" aria-label="За какой день">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={which === id} onClick={() => setWhich(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="cs-opts">
        <label>
          <input
            type="checkbox"
            checked={opts.rooms}
            onChange={(e) => setOpt({ rooms: e.target.checked })}
          />{' '}
          кабинеты
        </label>
        <label>
          <input
            type="checkbox"
            checked={opts.teachers}
            onChange={(e) => setOpt({ teachers: e.target.checked })}
          />{' '}
          учителя
        </label>
      </div>
      <textarea
        className="cs-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={which === 'week' ? 16 : 10}
        spellCheck={false}
        aria-label="Текст для чата"
      />
      <div className="backup-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void copy(text).then(() => setStatus('Скопировано — вставьте в чат.'))}
        >
          Скопировать
        </button>
        {mobile && (
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void shareText(text, `Расписание ${name}`)
                .then((r) => r === 'copied' && setStatus('Скопировано — вставьте в чат.'))
                .catch(() =>
                  setStatus('Не получилось открыть «Поделиться». Нажмите «Скопировать».'),
                )
            }
          >
            Поделиться
          </button>
        )}
        {text !== generated && (
          <button type="button" className="secondary" onClick={() => setText(generated)}>
            Вернуть как было
          </button>
        )}
      </div>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
    </section>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
