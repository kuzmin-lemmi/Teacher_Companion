import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useBackButton } from './back';
import { Backups } from './Backups';
import { lessonCount } from './calendar';
import type { AppData, Settings } from './domain';
import {
  BellsPage,
  CalendarPage,
  LessonsPage,
  Switch,
  TimeField,
  chevronLeft,
  chevronRight,
} from './MobileEditor';
import {
  allowBackground,
  allowNotifications,
  loadPhoneSettings,
  phoneStatus,
  pinWidget,
  savePhoneSettings,
  syncPhone,
  type PhoneSettings,
  type PhoneStatus,
} from './phone';
import type { Storage } from './storage';
import { useEditor } from './useEditor';
import { appVersion } from './version';
/** Телефон: настройки — список разделов, каждый раздел на весь экран. */
export type MobilePage =
  'menu' | 'lessons' | 'bells' | 'calendar' | 'notify' | 'preferences' | 'backups' | 'about';
const titles: Record<MobilePage, string> = {
  menu: 'Настройки',
  lessons: 'Уроки',
  bells: 'Звонки',
  calendar: 'Каникулы',
  notify: 'Уведомления и виджеты',
  preferences: 'Внешний вид',
  backups: 'Перенос и копии',
  about: 'О программе',
};
const themes: [Settings['theme'], string][] = [
  ['system', 'Как в системе'],
  ['light', 'Светлая'],
  ['dark', 'Тёмная'],
];
function summary(data: AppData) {
  const perDay = [1, 2, 3, 4, 5].map((d) => data.lessons.filter((l) => l.weekday === d).length);
  const bells = [...data.bells].sort((a, b) => a.lessonNumber - b.lessonNumber);
  const upcoming = data.holidays.filter((h) => h.end >= new Date().toISOString().slice(0, 10));
  return {
    lessons: data.lessons.length
      ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'].map((d, i) => `${d} ${perDay[i]}`).join(' · ')
      : 'Пока пусто — начните отсюда',
    bells: bells.length ? `${bells.length} · ${bells[0].start}–${bells.at(-1)!.end}` : 'Не заданы',
    calendar:
      [
        upcoming.length && `впереди: ${upcoming.length}`,
        data.shortDays.length && `сокращённых дней: ${data.shortDays.length}`,
      ]
        .filter(Boolean)
        .join(' · ') || 'Каникулы, праздники, сокращённые дни',
  };
}
function MenuRow({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="m-row m-menu-row" onClick={onClick}>
      <span className="m-row-main">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      {chevronRight}
    </button>
  );
}
function EditorPage({
  page,
  storage,
  onDirty,
}: {
  page: 'lessons' | 'bells' | 'calendar';
  storage: Storage;
  onDirty: (dirty: boolean) => void;
}) {
  const editor = useEditor(storage, onDirty);
  if (editor.failure)
    return (
      <div role="alert" className="m-alert">
        <p>{editor.failure}</p>
        <button type="button" onClick={editor.retry}>
          Повторить
        </button>
      </div>
    );
  if (!editor.ready) return <p role="status">Загрузка расписания…</p>;
  if (page === 'lessons') return <LessonsPage editor={editor} />;
  if (page === 'bells') return <BellsPage editor={editor} />;
  return <CalendarPage editor={editor} />;
}
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string, string?][];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="m-choice">
      <legend>{label}</legend>
      {options.map(([id, title, hint]) => (
        <label key={id}>
          <input type="radio" name={label} checked={value === id} onChange={() => onChange(id)} />
          <span>
            {title}
            {hint && <small>{hint}</small>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
function PreferencesPage({
  settings,
  onSave,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const save = (patch: Partial<Settings>) => {
    setError('');
    onSave({ ...settings, ...patch }).catch((e) =>
      setError(e instanceof Error ? e.message : 'Не удалось сохранить настройки.'),
    );
  };
  return (
    <>
      <Choice
        label="Тема"
        value={settings.theme}
        options={themes}
        onChange={(theme) => save({ theme })}
      />
      <Choice
        label="Строка урока"
        value={settings.widgetSize}
        options={[
          ['normal', 'Подробно', 'Время начала и конца, предмет, кабинет'],
          ['compact', 'Коротко', 'Класс и время начала'],
        ]}
        onChange={(widgetSize) => save({ widgetSize })}
      />
      {error && (
        <p role="alert" className="m-alert">
          {error}
        </p>
      )}
      <p className="m-hint">Изменения применяются сразу.</p>
    </>
  );
}
const reminders: [number, string][] = [
  [0, 'Нет'],
  [2, 'За 2 мин'],
  [5, 'За 5 мин'],
  [10, 'За 10 мин'],
];
function notifyDetail(s: PhoneSettings) {
  return (
    [
      s.ongoing && 'урок в шторке',
      s.remind > 0 && `напоминание за ${s.remind} мин`,
      s.morning && `сводка в ${s.morningTime}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Выключены'
  );
}
/** Шторка, напоминания, утренняя сводка и виджеты на рабочем столе. */
function NotifyPage({ data }: { data: AppData }) {
  const [settings, setSettings] = useState(loadPhoneSettings);
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [message, setMessage] = useState('');
  const check = useCallback(() => {
    phoneStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);
  // Разрешения меняются в системных окнах — перепроверяем, когда приложение снова на экране.
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
  function update(patch: Partial<PhoneSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    savePhoneSettings(next);
    syncPhone(data, next).catch(() =>
      setMessage('Не удалось обновить уведомления. Попробуйте перезапустить приложение.'),
    );
  }
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
      {status && !status.notifications && (
        <div role="alert" className="m-alert">
          <p>Уведомления выключены — шторка и напоминания не появятся.</p>
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
      )}
      <h2 className="m-group">В шторке и на экране блокировки</h2>
      <div className="m-card">
        <Switch
          label="Текущий урок"
          hint="Класс, кабинет и отсчёт до звонка. Появляется за час до первого урока, после уроков исчезает."
          checked={settings.ongoing}
          onChange={(ongoing) => update({ ongoing })}
        />
      </div>
      <h2 className="m-group">Напоминать перед уроком</h2>
      <div className="m-segmented" role="group" aria-label="Напоминать перед уроком">
        {reminders.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={settings.remind === value}
            onClick={() => update({ remind: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="m-hint">
        Всплывает, как сообщение: «Через 5 мин — 7Б · каб. 214» и заметка к уроку.
      </p>
      <div className="m-card">
        <Switch
          label="Утренняя сводка"
          hint="Сколько сегодня уроков и когда первый. В выходные и каникулы не приходит."
          checked={settings.morning}
          onChange={(morning) => update({ morning })}
        />
        {settings.morning && (
          <TimeField
            label="Во сколько"
            value={settings.morningTime}
            onChange={(morningTime) => /^\d\d:\d\d$/.test(morningTime) && update({ morningTime })}
          />
        )}
      </div>
      <h2 className="m-group">Виджеты на рабочем столе</h2>
      <div className="m-list">
        <button type="button" className="m-row" onClick={() => void pin('now')}>
          <span className="m-row-main">
            <strong>Сейчас и далее</strong>
            <small>Урок и отсчёт до звонка</small>
          </span>
          <span className="m-row-action">Добавить</span>
        </button>
        <button type="button" className="m-row" onClick={() => void pin('day')}>
          <span className="m-row-main">
            <strong>Уроки на день</strong>
            <small>Весь день списком</small>
          </span>
          <span className="m-row-action">Добавить</span>
        </button>
      </div>
      {message && <p className="m-status">{message}</p>}
      <p className="m-hint">
        Вручную: нажмите и подержите пустое место на рабочем столе → «Виджеты» → «Помощник учителя».
        {status && status.widgets > 0 && ` Сейчас на рабочем столе виджетов: ${status.widgets}.`}
      </p>
      {status && !status.battery && (
        <>
          <h2 className="m-group">Если напоминания опаздывают</h2>
          <p className="m-hint">
            Некоторые телефоны (Realme, OPPO, Xiaomi, Huawei) усыпляют приложения ради экономии
            батареи. Разрешите «Помощнику учителя» работать в фоне — это почти не тратит заряд:
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
function AboutPage() {
  return (
    <div className="m-about">
      <span className="brand-icon">У</span>
      <h2>Помощник учителя</h2>
      <p>Версия {appVersion} · пробная версия для Android</p>
      <p className="m-hint">
        Расписание хранится только на этом телефоне и работает без интернета. Приложение не
        отправляет данные на сервер и не требует аккаунта.
      </p>
      <p className="m-hint">
        Новую версию скачайте по той же ссылке, что и первую, и установите поверх — расписание и
        заметки сохранятся.
      </p>
    </div>
  );
}
export function MobileSettings({
  initial,
  data,
  editorStorage,
  onDirty,
  onRestore,
  onSaveSettings,
  onExit,
}: {
  initial: MobilePage;
  data: AppData;
  editorStorage: Storage;
  onDirty: (dirty: boolean) => void;
  onRestore: (data: AppData) => Promise<void>;
  onSaveSettings: (settings: Settings) => Promise<void>;
  onExit: () => void;
}) {
  const [page, setPage] = useState<MobilePage>(initial);
  const back = () => (page === 'menu' ? onExit() : setPage('menu'));
  useBackButton(true, back);
  const info = summary(data);
  let content: ReactNode;
  if (page === 'menu')
    content = (
      <>
        <h2 className="m-group">Расписание</h2>
        <div className="m-list">
          <MenuRow title="Уроки" detail={info.lessons} onClick={() => setPage('lessons')} />
          <MenuRow title="Звонки" detail={info.bells} onClick={() => setPage('bells')} />
          <MenuRow
            title="Каникулы и сокращённые дни"
            detail={info.calendar}
            onClick={() => setPage('calendar')}
          />
        </div>
        <h2 className="m-group">Приложение</h2>
        <div className="m-list">
          <MenuRow
            title="Уведомления и виджеты"
            detail={notifyDetail(loadPhoneSettings())}
            onClick={() => setPage('notify')}
          />
          <MenuRow
            title="Внешний вид"
            detail={`${themes.find(([t]) => t === data.settings.theme)?.[1]} тема · ${
              data.settings.widgetSize === 'compact' ? 'коротко' : 'подробно'
            }`}
            onClick={() => setPage('preferences')}
          />
          <MenuRow
            title="Перенос и копии"
            detail={`QR-код с компьютера · ${lessonCount(data.lessons.length)} в неделе`}
            onClick={() => setPage('backups')}
          />
          <MenuRow
            title="О программе"
            detail={`Версия ${appVersion}`}
            onClick={() => setPage('about')}
          />
        </div>
      </>
    );
  else if (page === 'lessons' || page === 'bells' || page === 'calendar')
    content = <EditorPage key={page} page={page} storage={editorStorage} onDirty={onDirty} />;
  else if (page === 'notify') content = <NotifyPage data={data} />;
  else if (page === 'preferences')
    content = <PreferencesPage settings={data.settings} onSave={onSaveSettings} />;
  else if (page === 'backups')
    content = (
      <div className="m-backups">
        <Backups data={data} onRestore={onRestore} storage={editorStorage} />
      </div>
    );
  else content = <AboutPage />;
  return (
    <div className="m-root">
      <header className="m-bar">
        <button
          type="button"
          className="m-back"
          aria-label={page === 'menu' ? 'К расписанию' : 'К настройкам'}
          onClick={back}
        >
          {chevronLeft}
        </button>
        <h1>{titles[page]}</h1>
      </header>
      <main className="m-content">{content}</main>
    </div>
  );
}
