import { isTauri } from '@tauri-apps/api/core';
/** Доступная новая версия. Установка — только по явному нажатию учителя. */
export type AvailableUpdate = {
  version: string;
  notes: string;
  install(onProgress: (percent: number | null) => void): Promise<void>;
};
export type UpdateFinder = () => Promise<AvailableUpdate | null>;
/** Спрашивает GitHub о новой версии. В браузерном предпросмотре обновлений нет. */
export const findUpdate: UpdateFinder = async () => {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? '',
    async install(onProgress) {
      let total = 0;
      let done = 0;
      // Подпись файла проверяет плагин: чужой установщик не будет запущен.
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0;
        else if (event.event === 'Progress') {
          done += event.data.chunkLength;
          onProgress(total ? Math.min(99, Math.round((done * 100) / total)) : null);
        } else onProgress(100);
      });
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
};
const dismissKey = 'teacher-companion-update-dismissed';
/** Версия, про которую учитель сказал «Не сейчас»: для неё не показываем отметки. */
export function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(dismissKey);
  } catch {
    return null;
  }
}
export function dismissUpdate(version: string) {
  try {
    localStorage.setItem(dismissKey, version);
  } catch {}
}
export const UPDATE_FIRST_CHECK = 8_000;
export const UPDATE_INTERVAL = 12 * 60 * 60 * 1000;
