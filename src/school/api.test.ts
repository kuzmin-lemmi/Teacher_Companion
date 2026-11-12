// @vitest-environment jsdom
/**
 * Полный цикл через настоящий код сервера (server/yandex/handler.mjs) без сети:
 * fetch подменён и вызывает обработчик функции с хранилищем в памяти.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error — сервер на чистом JS без типов
import { handle } from '../../server/yandex/handler.mjs';
import { schoolApi, ServerError } from './api';
import { parseAscXml } from './asc';
import { generateSchoolKey } from './crypto';
import { nextPublication, scheduleForDate } from './publication';

const SERVER = 'https://functions.example.ru/fn';

function fakeCloud() {
  const m = new Map<string, string>();
  const store = {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    del: async (k: string) => void m.delete(k),
  };
  return vi.fn(async (input: URL | string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = (init.headers ?? {}) as Record<string, string>;
    const r = await handle(
      {
        httpMethod: init.method ?? 'GET',
        queryStringParameters: Object.fromEntries(url.searchParams),
        headers,
        body: init.body as string | undefined,
      },
      store,
    );
    return new Response(r.statusCode === 204 ? null : r.body, {
      status: r.statusCode,
      headers: r.headers,
    });
  });
}

const schedule = parseAscXml(readFileSync('src/school/samples/demo-asc.xml', 'utf8'));
const changed = parseAscXml(readFileSync('src/school/samples/demo-asc-zameny.xml', 'utf8'));

describe('клиент сервера расписания', () => {
  beforeEach(() => vi.stubGlobal('fetch', fakeCloud()));
  afterEach(() => vi.unstubAllGlobals());

  it('завуч подключает школу и отправляет, учитель получает и расшифровывает', async () => {
    expect((await schoolApi.health(SERVER)).ok).toBe(true);
    const { school, publishToken } = await schoolApi.setup(SERVER, 'Гимназия');
    const link = { server: SERVER, school, key: generateSchoolKey() };
    expect(await schoolApi.fetch(link)).toBeNull(); // ещё ничего не отправлено

    const opt = { school: { id: school, name: 'Гимназия' }, today: '2026-11-12' };
    const p1 = nextPublication(null, { kind: 'base', validFrom: '2026-11-09', schedule }, opt);
    expect((await schoolApi.publish(link, publishToken, p1)).version).toBe(1);
    const p2 = nextPublication(
      p1,
      { kind: 'override', date: '2026-11-13', schedule: changed },
      opt,
    );
    expect((await schoolApi.publish(link, publishToken, p2)).version).toBe(2);

    const got = (await schoolApi.fetch(link))!;
    expect(got.version).toBe(2);
    expect(got.publication.overrides.map((o) => o.date)).toEqual(['2026-11-13']);
    expect(scheduleForDate(got.publication, '2026-11-13')!.entries.length).toBeGreaterThan(0);
    expect((await schoolApi.meta(link)).version).toBe(2);

    // откат возвращает прошлую публикацию, номер версии растёт
    expect((await schoolApi.rollback(link, publishToken)).version).toBe(3);
    expect((await schoolApi.fetch(link))!.publication.overrides).toEqual([]);
  });

  it('понятные ошибки: чужой ключ завуча, чужой ключ школы, вторая школа, нет сети', async () => {
    const { school, publishToken } = await schoolApi.setup(SERVER, '');
    const link = { server: SERVER, school, key: generateSchoolKey() };
    const p = nextPublication(
      null,
      { kind: 'base', validFrom: '2026-11-09', schedule },
      { school: { id: school, name: '' }, today: '2026-11-12' },
    );
    await expect(schoolApi.publish(link, 'чужой', p)).rejects.toThrow('Неверный ключ завуча');
    await schoolApi.publish(link, publishToken, p);
    await expect(schoolApi.fetch({ ...link, key: generateSchoolKey() })).rejects.toThrow(
      'Ключ школы не подходит',
    );
    await expect(schoolApi.setup(SERVER, '')).rejects.toThrow('уже подключена');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const err = await schoolApi.meta(link).catch((e) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect(err.message).toContain('Нет связи');
  });
});
