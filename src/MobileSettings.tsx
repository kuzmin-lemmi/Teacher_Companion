import { useState, type ReactNode } from 'react';
import { useBackButton } from './back';
import { Backups } from './Backups';
import { lessonCount } from './calendar';
import { COLOR_PRESETS, extractParallels, isoDate, type AppData, type Settings } from './domain';
import {
  BellsPage,
  CalendarPage,
  Choice,
  LessonsPage,
  chevronLeft,
  chevronRight,
} from './MobileEditor';
import {
  NotifyDetail,
  NotifyList,
  WidgetsPage,
  notifySummary,
  notifyTitles,
  type NotifyKind,
} from './MobileNotify';
import { loadPhoneSettings } from './phone';
import type { Storage } from './storage';
import { useEditor } from './useEditor';
import { appVersion } from './version';
/** Телефон: настройки — список разделов, каждый раздел на весь экран. */
export type MobilePage =
  | 'menu'
  | 'lessons'
  | 'bells'
  | 'calendar'
  | 'notify'
  | `notify:${NotifyKind}`
  | 'widgets'
  | 'preferences'
  | 'backups'
  | 'about';
const titles: Record<Exclude<MobilePage, `notify:${NotifyKind}`>, string> = {
  menu: 'Настройки',
  lessons: 'Уроки',
  bells: 'Звонки',
  calendar: 'Каникулы',
  notify: 'Уведомления',
  widgets: 'Виджеты',
  preferences: 'Внешний вид',
  backups: 'Перенос и копии',
  about: 'О программе',
};
const titleOf = (page: MobilePage) =>
  page.startsWith('notify:')
    ? notifyTitles[page.slice(7) as NotifyKind]
    : titles[page as keyof typeof titles];
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
  const back = () =>
    page === 'menu' ? onExit() : setPage(page.startsWith('notify:') ? 'notify' : 'menu');
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
            title="Уведомления"
            detail={notifySummary(loadPhoneSettings())}
            onClick={() => setPage('notify')}
          />
          <MenuRow
            title="Виджеты на рабочем столе"
            detail="Текущий урок и уроки на день"
            onClick={() => setPage('widgets')}
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
  else if (page === 'notify')
    content = <NotifyList data={data} onOpen={(kind) => setPage(`notify:${kind}`)} />;
  else if (page.startsWith('notify:'))
    content = <NotifyDetail key={page} data={data} kind={page.slice(7) as NotifyKind} />;
  else if (page === 'widgets') content = <WidgetsPage />;
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
          aria-label={
            page === 'menu'
              ? 'К расписанию'
              : page.startsWith('notify:')
                ? 'К уведомлениям'
                : 'К настройкам'
          }
          onClick={back}
        >
          {chevronLeft}
        </button>
        <h1>{titleOf(page)}</h1>
      </header>
      <main className="m-content">{content}</main>
    </div>
  );
}
