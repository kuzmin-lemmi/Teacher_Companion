import { useCallback, useEffect, useState } from 'react';
import { lessonCount } from './calendar';
import type { AppData } from './domain';
import { Choice, Switch, TimeField, chevronRight } from './MobileEditor';
import {
  ENDING_TEXT,
  allowBackground,
  allowNotifications,
  buildPlan,
  loadPhoneSettings,
  phoneStatus,
  pinWidget,
  previewSound,
  savePhoneSettings,
  syncPhone,
  type PhonePreview,
  type PhoneSettings,
  type PhoneSound,
  type PhoneStatus,
} from './phone';
/**
 * Телефон: уведомления. Список — что приходит и как; каждое уведомление настраивается на
 * своём экране: как оно выглядит, присылать ли, когда и как сообщать.
 */
export type NotifyKind = PhonePreview;
export const notifyTitles: Record<NotifyKind, string> = {
  remind: 'Перед уроком',
  ending: 'Перед концом урока',
  morning: 'Утренняя сводка',
  evening: 'Сводка на завтра',
};
const soundWords: Record<PhoneSound, string> = {
  chime: 'со звуком',
  vibrate: 'вибрация',
  silent: 'беззвучно',
};
const soundOptions: [PhoneSound, string, string][] = [
  ['chime', 'Звук', 'Мягкий перезвон «Помощника учителя» и короткая вибрация'],
  ['vibrate', 'Только вибрация', 'Телефон коротко завибрирует, без звука'],
  ['silent', 'Беззвучно', 'Уведомление просто появится в шторке'],
];
/** Что делает уведомление — одной фразой, для подсказки у «Присылать». */
const purpose: Record<NotifyKind, string> = {
  remind: 'За несколько минут до начала каждого урока: какой класс, кабинет и заметка к уроку.',
  ending: 'За несколько минут до звонка с урока — чтобы успеть подвести итоги и задать ДЗ.',
  morning: 'Утром в учебный день: какой сегодня день, сколько уроков и когда первый.',
  evening: 'Вечером, если завтра есть уроки: сколько их, когда первый и заметки к урокам.',
};
const minuteOptions = [2, 5, 10];
function enabled(s: PhoneSettings, kind: NotifyKind) {
  if (kind === 'remind') return s.remind > 0;
  if (kind === 'ending') return s.ending > 0;
  return kind === 'morning' ? s.morning : s.evening;
}
function soundOf(s: PhoneSettings, kind: NotifyKind): PhoneSound {
  return s[`${kind}Sound`];
}
/** «За 5 мин · со звуком», «В 07:30 · вибрация» или «Выключено». */
export function notifyState(s: PhoneSettings, kind: NotifyKind) {
  if (!enabled(s, kind)) return 'Выключено';
  const when =
    kind === 'remind'
      ? `За ${s.remind} мин до начала`
      : kind === 'ending'
        ? `За ${s.ending} мин до звонка`
        : `В ${kind === 'morning' ? s.morningTime : s.eveningTime}`;
  return `${when} · ${soundWords[soundOf(s, kind)]}`;
}
/** Для строки меню «Уведомления». */
export function notifySummary(s: PhoneSettings) {
  const on = (Object.keys(notifyTitles) as NotifyKind[]).filter((k) => enabled(s, k));
  if (!on.length && !s.ongoing) return 'Выключены';
  return [s.ongoing && 'урок в шторке', on.length && `включено: ${on.length} из 4`]
    .filter(Boolean)
    .join(' · ');
}
/** Настройки уведомлений: сохраняются на телефоне и сразу уходят в плагин. */
function usePhoneSettings(data: AppData) {
  const [settings, setSettings] = useState(loadPhoneSettings);
  const [message, setMessage] = useState('');
  function update(patch: Partial<PhoneSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePhoneSettings(next);
    syncPhone(data, next).catch(() =>
      setMessage('Не удалось обновить уведомления. Попробуйте перезапустить приложение.'),
    );
  }
  return { settings, update, message, setMessage };
}
/** Разрешения меняются в системных окнах — перепроверяем, когда приложение снова на экране. */
function usePhoneStatus() {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const check = useCallback(() => {
    phoneStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);
  useEffect(() => {
    check();
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [check]);
  return { status, check };
}
function PermissionAlert({ status, check }: ReturnType<typeof usePhoneStatus>) {
  if (!status || status.notifications) return null;
  return (
    <div role="alert" className="m-alert">
      <p>Уведомления запрещены в настройках телефона — они не будут приходить.</p>
      <button
        type="button"
        className="m-primary"
        onClick={() => {
          void allowNotifications();
          // Системный запрос не сообщает об ответе — смотрим сами, пока он открыт.
          for (const delay of [1500, 4000, 8000]) setTimeout(check, delay);
        }}
      >
        Разрешить уведомления
      </button>
    </div>
  );
}
/** Список уведомлений: что приходит, когда и как — каждое открывается на своём экране. */
export function NotifyList({
  data,
  onOpen,
}: {
  data: AppData;
  onOpen: (kind: NotifyKind) => void;
}) {
  const { settings, update, message } = usePhoneSettings(data);
  const phone = usePhoneStatus();
  return (
    <>
      <PermissionAlert {...phone} />
      <h2 className="m-group">Что присылать</h2>
      <div className="m-list">
        {(Object.keys(notifyTitles) as NotifyKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="m-row m-menu-row"
            onClick={() => onOpen(kind)}
          >
            <span className="m-row-main">
              <strong>{notifyTitles[kind]}</strong>
              <small className={enabled(settings, kind) ? undefined : 'm-off'}>
                {notifyState(settings, kind)}
              </small>
            </span>
            {chevronRight}
          </button>
        ))}
      </div>
      <h2 className="m-group">Всегда на виду</h2>
      <div className="m-card">
        <Switch
          label="Урок в шторке"
          hint="Какой урок идёт и сколько до звонка — в шторке и на экране блокировки. Без звука."
          checked={settings.ongoing}
          onChange={(ongoing) => update({ ongoing })}
        />
      </div>
      <h2 className="m-group">Во время урока</h2>
      <div className="m-card">
        <Switch
          label="Не звенеть на уроке"
          hint="Пока идёт урок, уведомления со звуком только вибрируют. На переменах — как настроено."
          checked={settings.quiet}
          onChange={(quiet) => update({ quiet })}
        />
      </div>
      {message && <p className="m-status">{message}</p>}
      {phone.status && !phone.status.battery && (
        <>
          <h2 className="m-group">Если уведомления опаздывают</h2>
          <p className="m-hint">
            Некоторые телефоны (Realme, OPPO, Xiaomi, Huawei) усыпляют приложения ради экономии
            батареи. Разрешите «Помощнику учителя» работать в фоне — заряд почти не тратится:
            приложение просыпается только к звонкам.
          </p>
          <button type="button" className="m-secondary" onClick={() => void allowBackground()}>
            Разрешить работу в фоне
          </button>
        </>
      )}
    </>
  );
}
/** Ближайший учебный день из плана — для примера уведомления на настоящих уроках. */
function sampleDay(data: AppData, settings: PhoneSettings) {
  return buildPlan(data, settings).days.find((d) => d.lessons.length > 0);
}
function lessonTitle(l: { className: string; room: string }) {
  return [l.className || '7Б', l.room && `каб. ${l.room}`].filter(Boolean).join(' · ');
}
/** Заголовок и текст, как они появятся в шторке. */
function sample(kind: NotifyKind, data: AppData, s: PhoneSettings) {
  const day = sampleDay(data, s);
  const lesson = day?.lessons[0] ?? {
    number: 1,
    className: '7Б',
    room: '214',
    subject: 'Алгебра',
    start: '08:30',
  };
  const first = `Первый — ${lesson.number}-й урок в ${lesson.start}: ${lessonTitle(lesson)}`;
  const count = lessonCount(day?.lessons.length ?? 5);
  const weekday = day
    ? new Date(`${day.date}T12:00`).toLocaleDateString('ru', { weekday: 'long' })
    : 'понедельник';
  if (kind === 'remind')
    return {
      title: `Через ${s.remind || 5} мин — ${lessonTitle(lesson)}`,
      text: [`${lesson.number}-й урок в ${lesson.start}`, lesson.subject]
        .filter(Boolean)
        .join(' · '),
    };
  if (kind === 'ending')
    return {
      title: `Через ${s.ending || 5} мин звонок — ${lesson.className || '7Б'}`,
      text: s.endingText || ENDING_TEXT,
    };
  return {
    title: `${kind === 'morning' ? 'Сегодня' : 'Завтра'} ${weekday} · ${count}`,
    text: first,
  };
}
/** Один вид уведомления: пример, присылать ли, когда и как сообщать. */
export function NotifyDetail({ data, kind }: { data: AppData; kind: NotifyKind }) {
  const { settings, update, message, setMessage } = usePhoneSettings(data);
  const phone = usePhoneStatus();
  const [endingText, setEndingText] = useState(settings.endingText);
  // Выключили и снова включили — вернуть прежние минуты, а не сбросить на 5.
  const [lastMinutes, setLastMinutes] = useState({
    remind: settings.remind || 5,
    ending: settings.ending || 5,
  });
  const on = enabled(settings, kind);
  const sound = soundOf(settings, kind);
  // Текст ещё не сохранён (сохраняется, когда поле теряет фокус), но пример — уже с ним.
  const example = sample(kind, data, { ...settings, endingText: endingText.trim() });
  function toggle(value: boolean) {
    if (kind === 'remind') update({ remind: value ? lastMinutes.remind : 0 });
    else if (kind === 'ending') update({ ending: value ? lastMinutes.ending : 0 });
    else if (kind === 'morning') update({ morning: value });
    else update({ evening: value });
  }
  function minutes(value: number) {
    if (kind === 'remind') {
      setLastMinutes({ ...lastMinutes, remind: value });
      update({ remind: value });
    } else {
      setLastMinutes({ ...lastMinutes, ending: value });
      update({ ending: value });
    }
  }
  function setSound(value: PhoneSound) {
    const patch: Record<NotifyKind, Partial<PhoneSettings>> = {
      remind: { remindSound: value },
      ending: { endingSound: value },
      morning: { morningSound: value },
      evening: { eveningSound: value },
    };
    update(patch[kind]);
  }
  function preview() {
    setMessage('');
    previewSound(kind, sound)
      .then(() => setMessage('Пример отправлен — посмотрите в шторке.'))
      .catch(() => setMessage('Не удалось показать пример. Попробуйте перезапустить приложение.'));
  }
  const atLesson = (kind === 'remind' || kind === 'ending') && settings.quiet && sound === 'chime';
  return (
    <>
      <PermissionAlert {...phone} />
      <h2 className="m-group">Так оно выглядит</h2>
      <div className={`m-notice${on ? '' : ' m-notice-off'}`} aria-label="Пример уведомления">
        <span className="m-notice-app">
          <span className="m-notice-icon">У</span>
          Помощник учителя · сейчас
        </span>
        <strong>{example.title}</strong>
        <span>{example.text}</span>
      </div>
      <div className="m-card">
        <Switch label="Присылать" hint={purpose[kind]} checked={on} onChange={toggle} />
      </div>
      {on && (
        <>
          <h2 className="m-group">Когда</h2>
          {kind === 'remind' || kind === 'ending' ? (
            <div className="m-segmented m-segmented-3" role="group" aria-label="Когда">
              {minuteOptions.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={settings[kind] === m}
                  onClick={() => minutes(m)}
                >
                  За {m} мин
                </button>
              ))}
            </div>
          ) : (
            <div className="m-card">
              <TimeField
                label={kind === 'morning' ? 'Во сколько утром' : 'Во сколько вечером'}
                value={kind === 'morning' ? settings.morningTime : settings.eveningTime}
                onChange={(time) =>
                  /^\d\d:\d\d$/.test(time) &&
                  update(kind === 'morning' ? { morningTime: time } : { eveningTime: time })
                }
              />
            </div>
          )}
          <p className="m-hint">
            {kind === 'remind'
              ? 'До начала каждого урока.'
              : kind === 'ending'
                ? 'До звонка с каждого урока.'
                : 'В выходные и каникулы не приходит.'}
          </p>
          {kind === 'ending' && (
            <div className="m-card">
              <label className="m-field">
                <span>Текст уведомления</span>
                <textarea
                  rows={2}
                  value={endingText}
                  maxLength={200}
                  placeholder={ENDING_TEXT}
                  onChange={(e) => setEndingText(e.target.value)}
                  onBlur={() => {
                    const text = endingText.trim() || ENDING_TEXT;
                    setEndingText(text);
                    if (text !== settings.endingText) update({ endingText: text });
                  }}
                />
              </label>
            </div>
          )}
          <Choice label="Как сообщать" value={sound} options={soundOptions} onChange={setSound} />
          {atLesson && (
            <p className="m-hint">
              Включено «Не звенеть на уроке»: если уведомление придёт во время урока, будет только
              вибрация.
            </p>
          )}
          <button type="button" className="m-secondary" onClick={preview}>
            Прислать пример сейчас
          </button>
        </>
      )}
      {message && <p className="m-status">{message}</p>}
    </>
  );
}
/** Виджеты на рабочем столе — отдельно от уведомлений. */
export function WidgetsPage() {
  const { status, check } = usePhoneStatus();
  const [message, setMessage] = useState('');
  async function pin(kind: 'now' | 'day') {
    setMessage('');
    const ok = await pinWidget(kind).catch(() => false);
    if (!ok)
      setMessage(
        'Этот рабочий стол не умеет добавлять виджеты из приложения. Добавьте вручную — как написано ниже.',
      );
    else setTimeout(check, 1500);
  }
  return (
    <>
      <h2 className="m-group">Добавить на рабочий стол</h2>
      <div className="m-list">
        <button type="button" className="m-row" onClick={() => void pin('now')}>
          <span className="m-row-main">
            <strong>Сейчас и далее</strong>
            <small>Текущий урок и отсчёт до звонка</small>
          </span>
          <span className="m-row-action">Добавить</span>
        </button>
        <button type="button" className="m-row" onClick={() => void pin('day')}>
          <span className="m-row-main">
            <strong>Уроки на день</strong>
            <small>Все уроки сегодня, после уроков — на завтра</small>
          </span>
          <span className="m-row-action">Добавить</span>
        </button>
      </div>
      {message && <p className="m-status">{message}</p>}
      <p className="m-hint">
        Вручную: нажмите и подержите пустое место на рабочем столе → «Виджеты» → «Помощник учителя».
        {status && status.widgets > 0 && ` Сейчас на рабочем столе виджетов: ${status.widgets}.`}
      </p>
    </>
  );
}
