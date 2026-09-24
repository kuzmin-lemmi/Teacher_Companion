import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { browserStorage, upsert } from './storage';
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
  });
  await expect(store.load()).rejects.toThrow();
  expect(raw).toBe('broken');
});
