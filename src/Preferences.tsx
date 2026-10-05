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
  const alertOn = (draft.bellAlertMinutes ?? 5) > 0;
  return (
    <div className="preferences pf">
      <fieldset disabled={busy} className="pf-grid">
        <div className="pf-col">
          <section className="pf-card">
            <h2>Виджет</h2>
            <label className="pf-row">
              <span>Тема</span>
              <select
                value={draft.theme}
                onChange={(e) => update({ theme: e.target.value as Settings['theme'] })}
              >
                <option value="dark">Тёмная</option>
                <option value="light">Светлая</option>
                <option value="system">Системная</option>
              </select>
            </label>
            <label className="pf-row">
              <span>Размер</span>
              <select
                value={draft.widgetSize}
                onChange={(e) => update({ widgetSize: e.target.value as Settings['widgetSize'] })}
              >
                <option value="normal">Обычный — время, предмет, кабинет</option>
                <option value="compact">Компактный — класс и начало</option>
              </select>
            </label>
            <label className="pf-row">
              <span>Положение</span>
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
            <div className="pf-row">
              <span>Акцент</span>
              <div className="pf-accents" role="radiogroup" aria-label="Цветовой акцент">
                {ACCENT_PRESETS.map((preset) => {
                  const isSelected = (draft.accentColor ?? 'emerald') === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={`pf-accent ${isSelected ? 'selected' : ''}`}
                      style={{ background: preset.color }}
                      onClick={() => update({ accentColor: preset.id as AccentColor })}
                      title={preset.name}
                      aria-label={preset.name}
                    />
                  );
                })}
              </div>
            </div>
            <label className="pf-row">
              <span>Фон {draft.opacity}%</span>
              <input
                type="range"
                min="80"
                max="100"
                step="1"
                aria-label="Непрозрачность фона"
                value={draft.opacity}
                onChange={(e) => update({ opacity: Number(e.target.value) })}
              />
            </label>
          </section>
          <section className="pf-card">
            <h2>Окно</h2>
            <label className="pf-toggle">
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
            <label className="pf-toggle">
              <div>
                <strong>Закрепить виджет</strong>
                <small>Защита от случайного перемещения.</small>
              </div>
              <input
                type="checkbox"
                checked={draft.locked}
                onChange={(e) => update({ locked: e.target.checked })}
              />
            </label>
            <label className="pf-row">
              <span>При закрытии</span>
              <select
                value={draft.closeBehavior}
                onChange={(e) =>
                  update({ closeBehavior: e.target.value as Settings['closeBehavior'] })
                }
              >
                <option value="tray">Свернуть в трей</option>
                <option value="exit">Завершить приложение</option>
              </select>
            </label>
            <button className="text-button" onClick={onResetPosition}>
              Вернуть виджет в угол: {cornerLabels[settings.widgetCorner].toLowerCase()}
            </button>
          </section>
          <section className="pf-card">
            <h2>Запуск и обновления</h2>
            <label className="pf-toggle">
              <div>
                <strong>Запускать вместе с Windows</strong>
                <small>
                  {isTauri()
                    ? 'После входа откроется ваше расписание. Переносной .exe держите в постоянной папке.'
                    : 'Применяется в Windows-приложении.'}
                </small>
              </div>
              <input
                type="checkbox"
                checked={draft.launchOnStartup}
                onChange={(e) => update({ launchOnStartup: e.target.checked })}
              />
            </label>
            <label className="pf-toggle">
              <div>
                <strong>Проверять обновления</strong>
                <small>Раз в несколько часов, только на GitHub. Расписание не отправляется.</small>
              </div>
              <input
                type="checkbox"
                checked={draft.checkUpdates}
                onChange={(e) => update({ checkUpdates: e.target.checked })}
              />
            </label>
          </section>
        </div>
        <div className="pf-col">
          <section className="pf-card color-tags-panel">
            <div className="pf-head">
              <h2>Цвета уроков</h2>
              <button type="button" className="secondary" onClick={() => addColorTag('class')}>
                + Тег
              </button>
            </div>
            <label className="pf-toggle">
              <div>
                <strong>Красить уроки по предметам автоматически</strong>
                <small>Свои теги важнее.</small>
              </div>
              <input
                type="checkbox"
                checked={draft.autoColors ?? true}
                onChange={(e) => update({ autoColors: e.target.checked })}
              />
            </label>
            {colorTags.length > 0 ? (
              <div className="pf-tags">
                {colorTags.map((tag, idx) => (
                  <div key={tag.id} className="pf-tag" data-color-tag={tag.color}>
                    <select
                      value={tag.target}
                      aria-label="Для чего тег"
                      onChange={(e) =>
                        updateColorTag(idx, { target: e.target.value as 'class' | 'subject' })
                      }
                    >
                      <option value="class">Класс</option>
                      <option value="subject">Предмет</option>
                    </select>
                    <input
                      type="text"
                      aria-label="Название класса или предмета"
                      placeholder={tag.target === 'class' ? '5 или 7А' : 'Математика'}
                      value={tag.pattern}
                      maxLength={30}
                      onChange={(e) => updateColorTag(idx, { pattern: e.target.value })}
                    />
                    <div className="pf-swatches" role="radiogroup" aria-label="Выбор цвета">
                      {COLOR_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`pf-swatch ${tag.color === preset.id ? 'active' : ''}`}
                          style={{ backgroundColor: preset.dot }}
                          title={preset.name}
                          aria-label={preset.name}
                          aria-checked={tag.color === preset.id}
                          onClick={() => updateColorTag(idx, { color: preset.id })}
                        />
                      ))}
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
              <p className="muted">
                Тегов пока нет: задайте цвет для параллели («5» — все пятые) или предмета.
              </p>
            )}
            {unconfiguredParallels.length > 0 && (
              <div className="pf-chips">
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
            )}
          </section>
          <section className="pf-card">
            <h2>Напоминание перед звонком</h2>
            <label className="pf-row">
              <span>Предупреждать</span>
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
            <label className="pf-row">
              <span>Текст</span>
              <input
                type="text"
                value={draft.bellAlertMessage ?? 'Пора подводить итоги и задавать ДЗ'}
                maxLength={100}
                placeholder="Пора подводить итоги и задавать ДЗ"
                onChange={(e) => update({ bellAlertMessage: e.target.value })}
              />
            </label>
            {alertOn && (
              <>
                <label className="pf-toggle">
                  <div>
                    <strong>Тихий звуковой сигнал</strong>
                    <small>Мягкий перезвон, не мешает уроку.</small>
                  </div>
                  <div className="pf-inline">
                    <button type="button" className="secondary" onClick={playChime}>
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
                  <label className="pf-toggle">
                    <div>
                      <strong>Всплывающее уведомление браузера</strong>
                      <small>Сообщение о скором звонке.</small>
                    </div>
                    <div className="pf-inline">
                      {!hasNotifPermission && (
                        <button
                          type="button"
                          className="secondary"
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
              </>
            )}
          </section>
        </div>
      </fieldset>
      <div className="ed-foot">
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
      </div>
    </div>
  );
}
