import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import {
  ACCENT_PRESETS,
  COLOR_PRESETS,
  extractParallels,
  type AccentColor,
  type ColorTag,
  type Lesson,
  type Settings,
  type WidgetCorner,
} from './domain';
import {
  playChime,
  canShowSystemNotification,
  isNotificationGranted,
  requestNotificationPermission,
  showSystemNotification,
} from './chime';
export const cornerLabels: Record<WidgetCorner, string> = {
  'top-right': 'Справа сверху',
  'top-left': 'Слева сверху',
  'bottom-right': 'Справа снизу',
  'bottom-left': 'Слева снизу',
};
export function Preferences({
  settings,
  lessons = [],
  onSave,
  onDirty,
  onResetPosition,
  onPreview,
}: {
  settings: Settings;
  lessons?: Lesson[];
  onSave: (settings: Settings) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onResetPosition: () => void;
  onPreview: (settings: Settings | null) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [hasNotifPermission, setHasNotifPermission] = useState(isNotificationGranted);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    onPreview(draft);
    return () => onPreview(null);
  }, [draft, onPreview]);
  useEffect(() => () => onDirty(false), [onDirty]);
  function update(patch: Partial<Settings>) {
    setDraft({ ...draft, ...patch });
    setStatus('');
  }
  const colorTags = draft.colorTags ?? [];
  function addColorTag(target: 'class' | 'subject' = 'class', pattern = '', color?: string) {
    const defaultColor = color ?? COLOR_PRESETS[colorTags.length % COLOR_PRESETS.length].id;
    const newTag: ColorTag = {
      id: crypto.randomUUID(),
      target,
      pattern,
      color: defaultColor,
    };
    update({ colorTags: [...colorTags, newTag] });
  }
  function updateColorTag(index: number, patch: Partial<ColorTag>) {
    update({ colorTags: colorTags.map((t, i) => (i === index ? { ...t, ...patch } : t)) });
  }
  function removeColorTag(index: number) {
    update({ colorTags: colorTags.filter((_, i) => i !== index) });
  }
  const existingPatterns = new Set(
    colorTags.filter((t) => t.target === 'class').map((t) => t.pattern.trim()),
  );
  const parallels = extractParallels(lessons);
  const unconfiguredParallels = parallels.filter((p) => !existingPatterns.has(p));
  async function save() {
    setBusy(true);
    try {
      await onSave(draft);
      setStatus('Настройки сохранены');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось сохранить настройки.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="preferences">
      <fieldset disabled={busy}>
        <section className="panel">
          <p className="eyebrow">ВНЕШНИЙ ВИД</p>
          <h2>Сделайте виджет своим</h2>
          <div className="preference-grid">
            <label>
              Тема
              <select
                value={draft.theme}
                onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}
              >
                <option value="dark">Тёмная</option>
                <option value="light">Светлая</option>
                <option value="system">Системная</option>
              </select>
            </label>
            <label>
              Размер виджета
              <select
                value={draft.widgetSize}
                onChange={(e) => update({ widgetSize: e.target.value as Settings['widgetSize'] })}
              >
                <option value="normal">Обычный — время, предмет и кабинет</option>
                <option value="compact">Компактный — класс и начало урока</option>
              </select>
            </label>
            <label>
              Положение на экране
              <select
                value={draft.widgetCorner}
                onChange={(e) => update({ widgetCorner: e.target.value as WidgetCorner })}
              >
                {Object.entries(cornerLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="accent-picker-section">
            <span className="accent-picker-title">Цветовой акцент интерфейса</span>
            <div className="accent-picker-options" role="radiogroup" aria-label="Цветовой акцент">
              {ACCENT_PRESETS.map((preset) => {
                const isSelected = (draft.accentColor ?? 'emerald') === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    className={`accent-option ${isSelected ? 'selected' : ''}`}
                    onClick={() => update({ accentColor: preset.id as AccentColor })}
                    title={preset.name}
                  >
                    <span className="accent-swatch" style={{ background: preset.color }}>
                      {isSelected && (
                        <svg
                          viewBox="0 0 12 12"
                          width="10"
                          height="10"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="2.5 6 4.5 8.5 9.5 3.5" />
                        </svg>
                      )}
                    </span>
                    <span className="accent-name">{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="range-label">
            Непрозрачность фона: {draft.opacity}%
            <input
              type="range"
              min="80"
              max="100"
              step="1"
              value={draft.opacity}
              onChange={(e) => update({ opacity: Number(e.target.value) })}
            />
          </label>
        </section>
        <section className="panel color-tags-panel">
          <div className="section-title">
            <div>
              <p className="eyebrow">ЦВЕТОВАЯ МАРКИРОВКА</p>
              <h2>Теги классов и предметов</h2>
              <p className="muted">
                Задайте цвета для параллелей (например, «5» для 5-х классов) или предметов. Цвет
                сразу отобразится в виджете и расписании на неделю.
              </p>
            </div>
            <button type="button" className="secondary" onClick={() => addColorTag('class')}>
              + Добавить тег
            </button>
          </div>

          <label className="setting-toggle">
            <div>
              <strong>Красить уроки по предметам автоматически</strong>
              <small>Каждый предмет получает свой цвет. Свои метки ниже важнее.</small>
            </div>
            <input
              type="checkbox"
              checked={draft.autoColors ?? true}
              onChange={(e) => update({ autoColors: e.target.checked })}
            />
          </label>
          {colorTags.length > 0 ? (
            <div className="color-tag-list">
              {colorTags.map((tag, idx) => (
                <div key={tag.id} className="color-tag-row">
                  <select
                    className="color-tag-target"
                    value={tag.target}
                    onChange={(e) =>
                      updateColorTag(idx, { target: e.target.value as 'class' | 'subject' })
                    }
                  >
                    <option value="class">Класс / параллель</option>
                    <option value="subject">Предмет</option>
                  </select>
                  <input
                    type="text"
                    className="color-tag-pattern"
                    placeholder={
                      tag.target === 'class' ? 'например: 5 или 7А' : 'например: Математика'
                    }
                    value={tag.pattern}
                    maxLength={30}
                    onChange={(e) => updateColorTag(idx, { pattern: e.target.value })}
                  />
                  <div className="color-swatches" role="radiogroup" aria-label="Выбор цвета">
                    {COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        className={`color-swatch ${tag.color === preset.id ? 'active' : ''}`}
                        style={{ backgroundColor: preset.dot }}
                        title={preset.name}
                        aria-label={preset.name}
                        aria-checked={tag.color === preset.id}
                        onClick={() => updateColorTag(idx, { color: preset.id })}
                      />
                    ))}
                  </div>
                  <div className="color-tag-preview" data-color-tag={tag.color}>
                    <span className="row-class">
                      {tag.pattern.trim() || (tag.target === 'class' ? 'Класс' : 'Предмет')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="delete"
                    title="Удалить тег"
                    aria-label="Удалить тег"
                    onClick={() => removeColorTag(idx)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted" style={{ margin: '14px 0 0' }}>
              Теги пока не созданы. Добавьте первый тег вручную или выберите параллель ниже.
            </p>
          )}

          {unconfiguredParallels.length > 0 && (
            <div className="quick-tag-suggestions">
              <span>Быстро добавить из расписания:</span>
              <div className="suggestion-chips">
                {unconfiguredParallels.map((p, i) => {
                  const color = COLOR_PRESETS[(colorTags.length + i) % COLOR_PRESETS.length].id;
                  return (
                    <button
                      key={p}
                      type="button"
                      className="suggestion-chip"
                      onClick={() => addColorTag('class', p, color)}
                    >
                      + {p}-е классы
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
        <section className="panel">
          <p className="eyebrow">НАПОМИНАНИЯ ПЕРЕД ЗВОНКОМ</p>
          <h2>Конец урока</h2>
          <p className="muted">
            Помогает вовремя подвести итоги, задать домашнее задание и завершить занятие без спешки.
          </p>
          <div className="preference-grid" style={{ marginTop: '16px' }}>
            <label>
              Предупреждать до звонка
              <select
                value={draft.bellAlertMinutes ?? 5}
                onChange={(e) => update({ bellAlertMinutes: Number(e.target.value) })}
              >
                <option value={0}>Выключено</option>
                <option value={2}>За 2 минуты</option>
                <option value={3}>За 3 минуты</option>
                <option value={5}>За 5 минут</option>
                <option value={10}>За 10 минут</option>
              </select>
            </label>
            <label>
              Текст напоминания
              <input
                type="text"
                value={draft.bellAlertMessage ?? 'Пора подводить итоги и задавать ДЗ'}
                maxLength={100}
                placeholder="Пора подводить итоги и задавать ДЗ"
                onChange={(e) => update({ bellAlertMessage: e.target.value })}
              />
            </label>
          </div>
          {(draft.bellAlertMinutes ?? 5) > 0 && (
            <div style={{ marginTop: '16px', display: 'grid', gap: '14px' }}>
              <label className="setting-toggle">
                <div>
                  <strong>Тихий звуковой сигнал</strong>
                  <small>Мягкий перезвон (синтезируется браузером, не мешает уроку).</small>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: '12px', padding: '4px 10px' }}
                    onClick={playChime}
                  >
                    ▶ Прослушать
                  </button>
                  <input
                    type="checkbox"
                    checked={draft.bellAlertSound ?? true}
                    onChange={(e) => update({ bellAlertSound: e.target.checked })}
                  />
                </div>
              </label>
              {canShowSystemNotification() && (
                <label className="setting-toggle">
                  <div>
                    <strong>Всплывающее уведомление браузера</strong>
                    <small>Сообщение о скором звонке.</small>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {!hasNotifPermission && (
                      <button
                        type="button"
                        className="secondary"
                        style={{ fontSize: '12px', padding: '4px 10px' }}
                        onClick={async () => {
                          const granted = await requestNotificationPermission();
                          setHasNotifPermission(granted);
                          if (granted) {
                            showSystemNotification(
                              'Помощник учителя',
                              'Уведомления успешно включены!',
                            );
                          }
                        }}
                      >
                        Разрешить в системе
                      </button>
                    )}
                    <input
                      type="checkbox"
                      checked={draft.bellAlertPopup ?? true}
                      onChange={(e) => update({ bellAlertPopup: e.target.checked })}
                    />
                  </div>
                </label>
              )}
            </div>
          )}
        </section>
        <section className="panel">
          <p className="eyebrow">ПОВЕДЕНИЕ ОКНА</p>
          <h2>Всегда рядом</h2>
          <label className="setting-toggle">
            <div>
              <strong>Поверх других окон</strong>
              <small>Расписание остаётся видимым во время работы.</small>
            </div>
            <input
              type="checkbox"
              checked={draft.alwaysOnTop}
              onChange={(e) => update({ alwaysOnTop: e.target.checked })}
            />
          </label>
          <label className="setting-toggle">
            <div>
              <strong>Закрепить виджет</strong>
              <small>Защитить окно от случайного перемещения.</small>
            </div>
            <input
              type="checkbox"
              checked={draft.locked}
              onChange={(e) => update({ locked: e.target.checked })}
            />
          </label>
          <label>
            При закрытии окна
            <select
              value={draft.closeBehavior}
              onChange={(e) =>
                update({ closeBehavior: e.target.value as Settings['closeBehavior'] })
              }
            >
              <option value="tray">Свернуть в системный трей</option>
              <option value="exit">Завершить приложение</option>
            </select>
          </label>
          <button className="text-button" onClick={onResetPosition}>
            Вернуть виджет в угол: {cornerLabels[settings.widgetCorner].toLowerCase()}
          </button>
        </section>
        <section className="panel">
          <p className="eyebrow">АВТОЗАПУСК</p>
          <label className="setting-toggle">
            <div>
              <strong>Запускать вместе с Windows</strong>
              <small>
                {isTauri()
                  ? 'После входа в систему откроется ваше расписание.'
                  : 'В браузере доступен выбор настройки. Применяется в Windows-приложении.'}
              </small>
            </div>
            <input
              type="checkbox"
              checked={draft.launchOnStartup}
              onChange={(e) => update({ launchOnStartup: e.target.checked })}
            />
          </label>
          <p className="hint">
            Если вы запускаете переносной .exe, храните его в постоянной папке. После переноса
            выключите и снова включите эту настройку.
          </p>
        </section>
        <section className="panel">
          <p className="eyebrow">ОБНОВЛЕНИЯ</p>
          <label className="setting-toggle">
            <div>
              <strong>Проверять обновления</strong>
              <small>
                Раз в несколько часов программа узнаёт на GitHub, вышла ли новая версия, и покажет
                это в разделе «О программе». Устанавливается только по вашему желанию. Расписание
                никуда не отправляется.
              </small>
            </div>
            <input
              type="checkbox"
              checked={draft.checkUpdates}
              onChange={(e) => update({ checkUpdates: e.target.checked })}
            />
          </label>
        </section>
      </fieldset>
      <footer>
        <span role="status">
          {status || (dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены')}
        </span>
        <div>
          <button
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(settings);
              setStatus('');
            }}
          >
            Отменить изменения
          </button>
          <button className="primary" disabled={!dirty || busy} onClick={save}>
            {busy ? 'Сохранение…' : 'Сохранить настройки'}
          </button>
        </div>
      </footer>
    </div>
  );
}
