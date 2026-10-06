import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useBackButton } from './back';
import { Backups } from './Backups';
import { lessonCount } from './calendar';
import { COLOR_PRESETS, extractParallels, isoDate, type AppData, type Settings } from './domain';
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
  previewSound,
  savePhoneSettings,
  syncPhone,
  ENDING_TEXT,
  type PhonePreview,
  type PhoneSettings,
  type PhoneSound,
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
  const today = isoDate(new Date());
  const upcoming = data.holidays.filter((h) => h.end >= today);
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
  lessons = [],
  onSave,
}: {
  settings: Settings;
  lessons?: AppData['lessons'];
  /** Изменение накладывается на последние сохранённые настройки: быстрые нажатия подряд не теряются. */
  onSave: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [newTarget, setNewTarget] = useState<'class' | 'subject'>('class');
  const [newPattern, setNewPattern] = useState('');
  const [newColor, setNewColor] = useState('blue');
  const save = (patch: Partial<Settings>) => {
    setError('');
    onSave(patch).catch((e) =>
      setError(e instanceof Error ? e.message : 'Не удалось сохранить настройки.'),
    );
  };
  const colorTags = settings.colorTags ?? [];
  const addTag = (target: 'class' | 'subject', pattern: string, color: string) => {
    if (!pattern.trim()) return;
    const tag = {
      id: crypto.randomUUID(),
      target,
      pattern: pattern.trim(),
      color,
    };
    save({ colorTags: [...colorTags, tag] });
    setNewPattern('');
  };
  const removeTag = (id: string) => {
    save({ colorTags: colorTags.filter((t) => t.id !== id) });
  };
  const existingPatterns = new Set(
    colorTags.filter((t) => t.target === 'class').map((t) => t.pattern.trim()),
  );
  const parallels = extractParallels(lessons);
  const unconfiguredParallels = parallels.filter((p) => !existingPatterns.has(p));
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
      <h2 className="m-group">Цветовая маркировка</h2>
      <div className="m-card" style={{ padding: '14px 16px' }}>
        <p className="m-hint" style={{ margin: '0 0 12px' }}>
          Метки для классов (например, «5» для 5-х классов) или предметов.
        </p>
        {colorTags.length > 0 && (
          <div className="m-color-tags-list">
            {colorTags.map((tag) => (
              <div key={tag.id} className="m-color-tag-item" data-color-tag={tag.color}>
                <span className="row-class">{tag.pattern}</span>
                <span className="m-color-tag-desc">
                  {tag.target === 'class' ? 'класс / параллель' : 'предмет'}
                </span>
                <button
                  type="button"
                  className="m-delete-tag"
                  onClick={() => removeTag(tag.id)}
                  aria-label={`Удалить тег ${tag.pattern}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="m-add-tag-form">
          <div className="m-tag-inputs">
            <select
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value as 'class' | 'subject')}
              className="m-select"
            >
              <option value="class">Класс</option>
              <option value="subject">Предмет</option>
            </select>
            <input
              type="text"
              placeholder={newTarget === 'class' ? 'например: 5' : 'например: Алгебра'}
              value={newPattern}
              maxLength={30}
              onChange={(e) => setNewPattern(e.target.value)}
              className="m-input"
            />
          </div>
          <div className="color-swatches" role="radiogroup" aria-label="Выбор цвета">
            {COLOR_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`color-swatch ${newColor === preset.id ? 'active' : ''}`}
                style={{ backgroundColor: preset.dot }}
                title={preset.name}
                aria-label={preset.name}
                aria-checked={newColor === preset.id}
                onClick={() => setNewColor(preset.id)}
              />
            ))}
          </div>
          <button
            type="button"
            className="m-secondary"
            disabled={!newPattern.trim()}
            onClick={() => addTag(newTarget, newPattern, newColor)}
          >
            + Добавить метку
          </button>
        </div>
        {unconfiguredParallels.length > 0 && (
          <div style={{ marginTop: '12px' }}>
            <span className="m-hint" style={{ display: 'block', marginBottom: '6px' }}>
              Добавить из расписания:
            </span>
            <div className="suggestion-chips">
              {unconfiguredParallels.map((p, i) => {
                const color = COLOR_PRESETS[(colorTags.length + i) % COLOR_PRESETS.length].id;
                return (
                  <button
                    key={p}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => addTag('class', p, color)}
                  >
                    + {p}-е классы
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
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
const sounds: [PhoneSound, string][] = [
  ['chime', 'Звук'],
  ['vibrate', 'Вибрация'],
  ['silent', 'Тихо'],
];
function notifyDetail(s: PhoneSettings) {
  return (
    [
      s.ongoing && 'урок в шторке',
      s.remind > 0 && `напоминание за ${s.remind} мин`,
      s.ending > 0 && `до звонка ${s.ending} мин`,
      s.morning && `сводка в ${s.morningTime}`,
      s.evening && `на завтра в ${s.eveningTime}`,
    ]
      .filter(Boolean)
      .join(' · ') || 'Выключены'
  );
}
/** «Нет · За 2 мин · За 5 мин · За 10 мин» */
function Minutes({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="m-segmented" role="group" aria-label={label}>
      {reminders.map(([minutes, title]) => (
        <button
          key={minutes}
          type="button"
          aria-pressed={value === minutes}
          onClick={() => onChange(minutes)}
        >
          {title}
        </button>
      ))}
    </div>
  );
}
/** Звук, вибрация или тихо — и «Проверить»: пример уведомления приходит в шторку. */
function SoundPicker({
  label,
  value,
  onChange,
  onPreview,
}: {
  label: string;
  value: PhoneSound;
  onChange: (value: PhoneSound) => void;
  onPreview: () => void;
}) {
  return (
    <div className="m-sound">
      <div className="m-segmented" role="group" aria-label={label}>
        {sounds.map(([id, title]) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
            {title}
          </button>
        ))}
      </div>
      <button type="button" className="m-secondary" onClick={onPreview}>
        Проверить
      </button>
    </div>
  );
}
/** Шторка, напоминания, утренняя сводка и виджеты на рабочем столе. */
function NotifyPage({ data }: { data: AppData }) {
  const [settings, setSettings] = useState(loadPhoneSettings);
  // Текст сохраняется, когда поле теряет фокус, — не на каждую букву.
  const [endingText, setEndingText] = useState(settings.endingText);
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
  function preview(kind: PhonePreview, sound: PhoneSound) {
    setMessage('');
    previewSound(kind, sound).catch(() =>
      setMessage('Не удалось показать пример. Попробуйте перезапустить приложение.'),
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
      <Minutes
        label="Напоминать перед уроком"
        value={settings.remind}
        onChange={(remind) => update({ remind })}
      />
      <p className="m-hint">
        Всплывает, как сообщение: «Через 5 мин — 7Б · каб. 214» и заметка к уроку.
      </p>
      {settings.remind > 0 && (
        <SoundPicker
          label="Звук напоминания"
          value={settings.remindSound}
          onChange={(remindSound) => update({ remindSound })}
          onPreview={() => preview('remind', settings.remindSound)}
        />
      )}
      <h2 className="m-group">Перед концом урока</h2>
      <Minutes
        label="Перед концом урока"
        value={settings.ending}
        onChange={(ending) => update({ ending })}
      />
      <p className="m-hint">«Через 5 мин звонок — 7Б» и ваш текст. На уроке лучше вибрация.</p>
      {settings.ending > 0 && (
        <>
          <div className="m-card">
            <label className="m-field">
              <span>Текст</span>
              <input
                type="text"
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
          <SoundPicker
            label="Звук перед концом урока"
            value={settings.endingSound}
            onChange={(endingSound) => update({ endingSound })}
            onPreview={() => preview('ending', settings.endingSound)}
          />
        </>
      )}
      <h2 className="m-group">Сводки</h2>
      <div className="m-card">
        <Switch
          label="Утренняя сводка"
          hint="Какой сегодня день, сколько уроков, какой первый и во сколько. В выходные и каникулы не приходит."
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
      {settings.morning && (
        <SoundPicker
          label="Звук утренней сводки"
          value={settings.morningSound}
          onChange={(morningSound) => update({ morningSound })}
          onPreview={() => preview('morning', settings.morningSound)}
        />
      )}
      <div className="m-card">
        <Switch
          label="Сводка на завтра"
          hint="Вечером: сколько уроков завтра, какой первый и во сколько, заметки к урокам. Приходит, только если завтра есть уроки."
          checked={settings.evening}
          onChange={(evening) => update({ evening })}
        />
        {settings.evening && (
          <TimeField
            label="Во сколько"
            value={settings.eveningTime}
            onChange={(eveningTime) => /^\d\d:\d\d$/.test(eveningTime) && update({ eveningTime })}
          />
        )}
      </div>
      {settings.evening && (
        <SoundPicker
          label="Звук сводки на завтра"
          value={settings.eveningSound}
          onChange={(eveningSound) => update({ eveningSound })}
          onPreview={() => preview('evening', settings.eveningSound)}
        />
      )}
      <h2 className="m-group">На уроке</h2>
      <div className="m-card">
        <Switch
          label="Тихо во время уроков"
          hint="Пока идёт урок, вместо звука — вибрация. На переменах и после уроков — как выбрано выше."
          checked={settings.quiet}
          onChange={(quiet) => update({ quiet })}
        />
      </div>
      <p className="m-hint">
        «Звук» — мягкий перезвон «Помощника учителя», его легко отличить от мессенджеров. В
        беззвучном режиме телефона будет только вибрация.
      </p>
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
      <p>Версия {appVersion} для Android</p>
      <p className="m-hint">
        Расписание хранится только на этом телефоне и работает без интернета. Приложение не
        отправляет данные на сервер и не требует аккаунта.
      </p>
      <p className="m-hint">
        Новые версии — на странице github.com/kuzmin-lemmi/Teacher_Companion/releases: скачайте
        TeacherCompanion-Android.apk и установите поверх — расписание и заметки сохранятся.
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
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
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
    content = (
      <PreferencesPage settings={data.settings} lessons={data.lessons} onSave={onSaveSettings} />
    );
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
