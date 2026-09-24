import { isTauri } from '@tauri-apps/api/core';
import { decode, type AppData } from './domain';
export function serializeBackup(data: AppData) {
  return JSON.stringify(
    {
      application: 'teacher-companion',
      backupVersion: 1,
      createdAt: new Date().toISOString(),
      data,
    },
    null,
    2,
  );
}
export function parseBackup(raw: string): AppData {
  if (new TextEncoder().encode(raw).length > 1_000_000)
    throw new Error('Файл слишком большой. Максимум — 1 МБ.');
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Не удалось прочитать JSON-файл.');
  }
  if (value?.application !== 'teacher-companion' || value.backupVersion !== 1)
    throw new Error('Это не поддерживаемая резервная копия Помощника учителя.');
  return decode(JSON.stringify(value.data));
}
export async function exportBackup(data: AppData): Promise<boolean> {
  const content = serializeBackup(data);
  const filename = `teacher-companion-${new Date().toISOString().slice(0, 10)}.json`;
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: filename,
      filters: [{ name: 'Резервная копия', extensions: ['json'] }],
    });
    if (!path) return false;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
    return true;
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function importDesktopBackup(): Promise<AppData | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Резервная копия', extensions: ['json'] }],
  });
  if (!path) return null;
  const { stat, readTextFile } = await import('@tauri-apps/plugin-fs');
  if ((await stat(path)).size > 1_000_000)
    throw new Error('Файл слишком большой. Максимум — 1 МБ.');
  return parseBackup(await readTextFile(path));
}
