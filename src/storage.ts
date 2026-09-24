import { isTauri } from '@tauri-apps/api/core';
import { decode, emptyData, type AppData } from './domain';
export interface Storage {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
}
export const upsert =
  'INSERT INTO app_state (id, payload) VALUES (1, $1) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP';
export function browserStorage(storage: Pick<globalThis.Storage, 'getItem' | 'setItem'>): Storage {
  return {
    async load() {
      const raw = storage.getItem('teacher-companion-preview-v1');
      return raw ? decode(raw) : emptyData();
    },
    async save(data) {
      assertValid(data);
      storage.setItem('teacher-companion-preview-v1', JSON.stringify(data));
    },
  };
}
function assertValid(data: AppData) {
  decode(JSON.stringify(data));
}
let pending: Promise<Storage> | undefined;
export function getStorage(): Promise<Storage> {
  if (!pending)
    pending = createStorage().catch((error) => {
      pending = undefined;
      throw error;
    });
  return pending;
}
async function createStorage(): Promise<Storage> {
  if (!isTauri()) return browserStorage(localStorage);
  const { default: Database } = await import('@tauri-apps/plugin-sql');
  const db = await Database.load('sqlite:teacher-companion.db');
  return {
    async load() {
      const rows = await db.select<{ payload: string }[]>(
        'SELECT payload FROM app_state WHERE id = 1',
      );
      return rows.length ? decode(rows[0].payload) : emptyData();
    },
    async save(data) {
      assertValid(data);
      await db.execute(upsert, [JSON.stringify(data)]);
    },
  };
}
