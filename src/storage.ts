import { isTauri } from '@tauri-apps/api/core';
import { decode, emptyData, type AppData } from './domain';
import { appVersion } from './version';
export type SnapshotReason = 'daily' | 'update' | 'before-restore';
export type SnapshotInfo = {
  id: number;
  reason: SnapshotReason;
  version: string;
  createdAt: string;
  lessons: number;
  bells: number;
};
export type Draft = { data: AppData; savedAt: string };
export interface Storage {
  load(): Promise<AppData>;
  save(data: AppData): Promise<void>;
  /** Черновик редактора: правки, которые ещё нельзя применить из-за ошибок. */
  loadDraft?(): Promise<Draft | null>;
  saveDraft?(data: AppData | null): Promise<void>;
  /** Автоматические копии внутри хранилища — страховка при обновлениях и восстановлении. */
  snapshot?(data: AppData, reason: SnapshotReason): Promise<void>;
  autoSnapshot?(data: AppData): Promise<SnapshotReason | null>;
  listSnapshots?(): Promise<SnapshotInfo[]>;
  loadSnapshot?(id: number): Promise<AppData>;
}
export const upsert =
  'INSERT INTO app_state (id, payload) VALUES (1, $1) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP';
const KEEP_SNAPSHOTS = 30;
const hasContent = (data: AppData) => data.lessons.length > 0 || data.bells.length > 0;
function assertValid(data: AppData) {
  decode(JSON.stringify(data));
}
/** Черновик может быть с ошибками проверки, но должен иметь форму документа. */
function parseDraft(raw: string, savedAt: string): Draft | null {
  try {
    const data = JSON.parse(raw) as AppData;
    if (data?.version !== 1 || !Array.isArray(data.lessons) || !Array.isArray(data.bells))
      return null;
    return { data, savedAt };
  } catch {
    return null;
  }
}
/** Нужна ли копия при запуске: первая, после смены версии или раз в день. */
export function snapshotReason(
  last: { version: string; createdAt: string } | undefined,
  now = new Date(),
): SnapshotReason | null {
  if (!last) return 'daily';
  if (last.version !== appVersion) return 'update';
  return new Date(last.createdAt).toDateString() === now.toDateString() ? null : 'daily';
}
function info(
  id: number,
  reason: string,
  version: string,
  createdAt: string,
  payload: string,
): SnapshotInfo {
  const data = JSON.parse(payload) as AppData;
  return {
    id,
    reason: reason as SnapshotReason,
    version,
    createdAt,
    lessons: data.lessons?.length ?? 0,
    bells: data.bells?.length ?? 0,
  };
}
export function browserStorage(
  storage: Pick<globalThis.Storage, 'getItem' | 'setItem'> &
    Partial<Pick<globalThis.Storage, 'removeItem'>>,
): Storage {
  const keys = {
    state: 'teacher-companion-preview-v1',
    draft: 'teacher-companion-draft-v1',
    snapshots: 'teacher-companion-snapshots-v1',
  };
  type Stored = { id: number; reason: string; version: string; createdAt: string; payload: string };
  const readSnapshots = (): Stored[] => {
    try {
      return JSON.parse(storage.getItem(keys.snapshots) ?? '[]');
    } catch {
      return [];
    }
  };
  const self: Storage = {
    async load() {
      const raw = storage.getItem(keys.state);
      return raw ? decode(raw) : emptyData();
    },
    async save(data) {
      assertValid(data);
      storage.setItem(keys.state, JSON.stringify(data));
    },
    async loadDraft() {
      const raw = storage.getItem(keys.draft);
      if (!raw) return null;
      const { payload, savedAt } = JSON.parse(raw);
      return parseDraft(payload, savedAt);
    },
    async saveDraft(data) {
      if (!data) storage.removeItem?.(keys.draft);
      else
        storage.setItem(
          keys.draft,
          JSON.stringify({ payload: JSON.stringify(data), savedAt: new Date().toISOString() }),
        );
    },
    async snapshot(data, reason) {
      const list = readSnapshots();
      const id = (list.at(-1)?.id ?? 0) + 1;
      list.push({
        id,
        reason,
        version: appVersion,
        createdAt: new Date().toISOString(),
        payload: JSON.stringify(data),
      });
      storage.setItem(keys.snapshots, JSON.stringify(list.slice(-KEEP_SNAPSHOTS)));
    },
    async autoSnapshot(data) {
      const reason = hasContent(data) ? snapshotReason(readSnapshots().at(-1)) : null;
      if (reason) await self.snapshot!(data, reason);
      return reason;
    },
    async listSnapshots() {
      return readSnapshots()
        .reverse()
        .map((s) => info(s.id, s.reason, s.version, s.createdAt, s.payload));
    },
    async loadSnapshot(id) {
      const found = readSnapshots().find((s) => s.id === id);
      if (!found) throw new Error('Копия не найдена.');
      return decode(found.payload);
    },
  };
  return self;
}
/** Минимальный интерфейс базы: плагин SQL в приложении, node:sqlite в тестах. */
export interface SqlDb {
  select<T>(sql: string, params?: unknown[]): Promise<T>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}
export function sqlStorage(db: SqlDb): Storage {
  type Row = {
    id: number;
    reason: string;
    app_version: string;
    created_at: string;
    payload: string;
  };
  const self: Storage = {
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
    async loadDraft() {
      const rows = await db.select<{ payload: string; saved_at: string }[]>(
        'SELECT payload, saved_at FROM drafts WHERE id = 1',
      );
      return rows.length ? parseDraft(rows[0].payload, rows[0].saved_at) : null;
    },
    async saveDraft(data) {
      if (!data) await db.execute('DELETE FROM drafts WHERE id = 1');
      else
        await db.execute(
          'INSERT INTO drafts (id, payload, saved_at) VALUES (1, $1, $2) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, saved_at = excluded.saved_at',
          [JSON.stringify(data), new Date().toISOString()],
        );
    },
    async snapshot(data, reason) {
      await db.execute(
        'INSERT INTO snapshots (reason, app_version, payload, created_at) VALUES ($1, $2, $3, $4)',
        [reason, appVersion, JSON.stringify(data), new Date().toISOString()],
      );
      await db.execute(
        `DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ${KEEP_SNAPSHOTS})`,
      );
    },
    async autoSnapshot(data) {
      if (!hasContent(data)) return null;
      const rows = await db.select<{ app_version: string; created_at: string }[]>(
        'SELECT app_version, created_at FROM snapshots ORDER BY id DESC LIMIT 1',
      );
      const last = rows[0] && { version: rows[0].app_version, createdAt: rows[0].created_at };
      const reason = snapshotReason(last);
      if (reason) await self.snapshot!(data, reason);
      return reason;
    },
    async listSnapshots() {
      const rows = await db.select<Row[]>(
        'SELECT id, reason, app_version, created_at, payload FROM snapshots ORDER BY id DESC',
      );
      return rows.map((r) => info(r.id, r.reason, r.app_version, r.created_at, r.payload));
    },
    async loadSnapshot(id) {
      const rows = await db.select<{ payload: string }[]>(
        'SELECT payload FROM snapshots WHERE id = $1',
        [id],
      );
      if (!rows.length) throw new Error('Копия не найдена.');
      return decode(rows[0].payload);
    },
  };
  return self;
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
  return sqlStorage(await Database.load('sqlite:teacher-companion.db'));
}
