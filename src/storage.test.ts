import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserStorage, snapshotReason, sqlStorage, upsert, type SqlDb } from './storage';
import { appVersion } from './version';
import { decode, emptyData } from './domain';
it('сохраняет и восстанавливает SQLite после открытия нового соединения', () => {
  const folder = mkdtempSync(join(tmpdir(), 'teacher-test-'));
  const path = join(folder, 'schedule.db');
  let db = new DatabaseSync(path);
  try {
    const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    db.exec(schema);
    db.exec(schema);
    const data = emptyData();
    data.lessons.push({
      id: '1',
      weekday: 1,
      lessonNumber: 1,
      className: '6А',
      subject: 'Математика',
      room: '12',
    });
    db.prepare(upsert).run({ $1: JSON.stringify(data) });
    db.close();
    db = new DatabaseSync(path);
    expect(decode(db.prepare('SELECT payload FROM app_state').get()!.payload as string)).toEqual(
      data,
    );
    expect(() => db.prepare(upsert).run({ $1: 'invalid' })).toThrow();
    expect(decode(db.prepare('SELECT payload FROM app_state').get()!.payload as string)).toEqual(
      data,
    );
    data.lessons = [];
    db.prepare(upsert).run({ $1: JSON.stringify(data) });
    expect(db.prepare('SELECT count(*) AS n FROM app_state').get()!.n).toBe(1);
  } finally {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
it('не перезаписывает поврежденное хранилище при загрузке', async () => {
  let raw = 'broken';
  const store = browserStorage({
    getItem: () => raw,
    setItem: (_, v) => {
      raw = v;
    },
    removeItem: () => {},
  });
  await expect(store.load()).rejects.toThrow();
  expect(raw).toBe('broken');
});
function openDb(path: string) {
  const raw = new DatabaseSync(path);
  const bind = (params: unknown[] = []) =>
    Object.fromEntries(params.map((v, i) => [`$${i + 1}`, v as string | number]));
  const db: SqlDb = {
    async select<T>(sql: string, params?: unknown[]) {
      return raw.prepare(sql).all(bind(params)) as T;
    },
    async execute(sql: string, params?: unknown[]) {
      return raw.prepare(sql).run(bind(params));
    },
  };
  return { raw, db };
}
function withSchema(fn: (path: string) => Promise<void>) {
  const folder = mkdtempSync(join(tmpdir(), 'teacher-test-'));
  const path = join(folder, 'schedule.db');
  const { raw } = openDb(path);
  for (const file of ['./schema.sql', './schema-v2.sql'])
    raw.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  raw.close();
  return fn(path).finally(() => rmSync(folder, { recursive: true, force: true }));
}
const sample = () => {
  const data = emptyData();
  data.lessons.push({
    id: '1',
    weekday: 1,
    lessonNumber: 1,
    className: '6А',
    subject: '',
    room: '',
  });
  return data;
};
it('черновик с ошибками переживает перезапуск и удаляется после применения', () =>
  withSchema(async (path) => {
    let { raw, db } = openDb(path);
    const draft = sample();
    draft.lessons[0].className = '';
    await sqlStorage(db).saveDraft!(draft);
    raw.close();
    ({ raw, db } = openDb(path));
    const store = sqlStorage(db);
    expect((await store.loadDraft!())?.data).toEqual(draft);
    await store.saveDraft!(null);
    expect(await store.loadDraft!()).toBeNull();
    raw.close();
  }));
it('делает копию при первом запуске и после смены версии, хранит не больше 30', () =>
  withSchema(async (path) => {
    const { raw, db } = openDb(path);
    const store = sqlStorage(db);
    expect(await store.autoSnapshot!(emptyData())).toBeNull();
    expect(await store.autoSnapshot!(sample())).toBe('daily');
    expect(await store.autoSnapshot!(sample())).toBeNull();
    raw.exec("UPDATE snapshots SET app_version = '0.0.1'");
    expect(await store.autoSnapshot!(sample())).toBe('update');
    for (let i = 0; i < 35; i++) await store.snapshot!(sample(), 'before-restore');
    const list = await store.listSnapshots!();
    expect(list).toHaveLength(30);
    expect(list[0].lessons).toBe(1);
    expect(await store.loadSnapshot!(list[0].id)).toEqual(sample());
    raw.close();
  }));
it('копия прошлого дня не мешает новой ежедневной', () => {
  expect(snapshotReason({ version: appVersion, createdAt: '2026-01-01T10:00:00Z' })).toBe('daily');
  expect(snapshotReason({ version: appVersion, createdAt: new Date().toISOString() })).toBeNull();
});
