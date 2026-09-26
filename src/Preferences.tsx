import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import type { Settings, WidgetCorner } from './domain';
export const cornerLabels: Record<WidgetCorner, string> = {
  'top-right': 'Справа сверху',
  'top-left': 'Слева сверху',
  'bottom-right': 'Справа снизу',
  'bottom-left': 'Слева снизу',
};
export function Preferences({
  settings,
  onSave,
  onDirty,
  onResetPosition,
  onPreview,
  onboarding = false,
}: {
  settings: Settings;
  onSave: (settings: Settings) => Promise<void>;
  onDirty: (dirty: boolean) => void;
  onResetPosition: () => void;
  onPreview: (settings: Settings | null) => void;
  onboarding?: boolean;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
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
        {!onboarding && (
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
        )}
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
        {!onboarding && (
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
        )}
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
