import { isTauri } from '@tauri-apps/api/core';
import type { AvailableUpdate } from './updates';
import { appVersion } from './version';
export type UpdateState =
  | { phase: 'idle' | 'checking' | 'latest' | 'installing' }
  | { phase: 'downloading'; progress: number | null }
  | { phase: 'error'; message: string };
export function UpdatePanel({
  update,
  state,
  autoCheck,
  dismissed,
  onCheck,
  onInstall,
  onDismiss,
}: {
  update: AvailableUpdate | null;
  state: UpdateState;
  autoCheck: boolean;
  dismissed: boolean;
  onCheck: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  const working =
    state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing';
  return (
    <section className="panel updates" aria-labelledby="updates-title">
      <p className="eyebrow">ОБНОВЛЕНИЯ</p>
      <h2 id="updates-title">
        {update ? `Доступна версия ${update.version}` : `Установлена версия ${appVersion}`}
      </h2>
      {update ? (
        <>
          <p className="muted">
            Сейчас у вас версия {appVersion}. Обновляться не обязательно — можно продолжать работать
            как есть и установить позже.
          </p>
          {update.notes && <p className="update-notes">{update.notes}</p>}
          <p className="hint">
            Расписание и настройки сохранятся: перед установкой программа сделает резервную копию.
            Окно закроется на несколько секунд и откроется снова.
          </p>
          {state.phase === 'downloading' && (
            <p role="status" className="update-progress">
              Загрузка{state.progress === null ? '…' : ` ${state.progress}%`}
            </p>
          )}
          {state.phase === 'installing' && (
            <p role="status" className="update-progress">
              Устанавливаем обновление…
            </p>
          )}
          <div className="backup-actions">
            <button className="primary" disabled={working} onClick={onInstall}>
              Установить версию {update.version}
            </button>
            {!dismissed && (
              <button disabled={working} onClick={onDismiss}>
                Не сейчас
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {state.phase === 'latest'
              ? 'У вас последняя версия.'
              : !isTauri()
                ? 'Обновления устанавливаются в Windows-приложении.'
                : autoCheck
                  ? 'Программа сама проверяет обновления и покажет здесь, если выйдет новая версия.'
                  : 'Автоматическая проверка выключена в настройках. Проверить можно вручную.'}
          </p>
          <div className="backup-actions">
            <button disabled={working} onClick={onCheck}>
              {state.phase === 'checking' ? 'Проверяем…' : 'Проверить обновления'}
            </button>
          </div>
        </>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="hint">
          {state.message}
        </p>
      )}
    </section>
  );
}
