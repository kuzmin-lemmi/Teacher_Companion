import { describe, expect, it } from 'vitest';
// @ts-expect-error — сервер написан на чистом JS без типов, чтобы деплоить файл как есть
import { handle } from './handler.mjs';

type Res = { statusCode: number; body: string; headers: Record<string, string> };

function memoryStore() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    del: async (k: string) => void m.delete(k),
  };
}

const call = async (
  store: ReturnType<typeof memoryStore>,
  httpMethod: string,
  q: Record<string, string>,
  body?: unknown,
  token?: string,
) => {
  const r: Res = await handle(
    {
      httpMethod,
      queryStringParameters: q,
      headers: token ? { 'X-School-Token': token } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    store,
  );
  return { status: r.statusCode, json: r.body ? JSON.parse(r.body) : null, headers: r.headers };
};

describe('сервер расписания школы', () => {
  it('подключение, отправка, получение, откат', async () => {
    const st = memoryStore();
    expect((await call(st, 'GET', { op: 'health' })).json.ok).toBe(true);

    const setup = await call(st, 'POST', { op: 'setup' }, { name: 'Гимназия' });
    expect(setup.status).toBe(200);
    const { school, publishToken } = setup.json;
    expect(school).toMatch(/^[a-z0-9]{8,32}$/);
    expect((await call(st, 'POST', { op: 'setup' })).status).toBe(403); // вторая школа — нельзя

    expect((await call(st, 'GET', { op: 'current', school })).status).toBe(404);
    expect(
      (await call(st, 'PUT', { op: 'publish', school }, { blob: 'AAA' }, 'чужой')).status,
    ).toBe(403);
    expect((await call(st, 'PUT', { op: 'publish', school }, { blob: 'AAA' })).status).toBe(403);

    expect(
      (await call(st, 'PUT', { op: 'publish', school }, { blob: 'v1' }, publishToken)).json.version,
    ).toBe(1);
    expect(
      (await call(st, 'PUT', { op: 'publish', school }, { blob: 'v2' }, publishToken)).json.version,
    ).toBe(2);
    expect((await call(st, 'GET', { op: 'meta', school })).json.version).toBe(2);
    expect((await call(st, 'GET', { op: 'current', school })).json.blob).toBe('v2');

    // откат: содержимое прошлой версии, но номер растёт — приложения заметят
    const rb = await call(st, 'POST', { op: 'rollback', school }, undefined, publishToken);
    expect(rb.json.version).toBe(3);
    const cur = await call(st, 'GET', { op: 'current', school });
    expect([cur.json.version, cur.json.blob]).toEqual([3, 'v1']);

    // в хранилище только зашифрованное и хэш ключа завуча, не сам ключ
    expect([...st.m.values()].join()).not.toContain(publishToken);
  });

  it('хранит не больше 10 версий', async () => {
    const st = memoryStore();
    const { school, publishToken } = (await call(st, 'POST', { op: 'setup' })).json;
    for (let i = 1; i <= 13; i++)
      await call(st, 'PUT', { op: 'publish', school }, { blob: `v${i}` }, publishToken);
    expect([...st.m.keys()].filter((k) => k.includes('/v/'))).toHaveLength(10);
    expect((await call(st, 'GET', { op: 'current', school })).json.blob).toBe('v13');
  });

  it('переезд: приложения узнают новый адрес из meta', async () => {
    const st = memoryStore();
    const { school, publishToken } = (await call(st, 'POST', { op: 'setup' })).json;
    expect(
      (await call(st, 'POST', { op: 'move', school }, { movedTo: 'http://x' }, publishToken))
        .status,
    ).toBe(400);
    await call(
      st,
      'POST',
      { op: 'move', school },
      { movedTo: 'https://new.example/api' },
      publishToken,
    );
    expect((await call(st, 'GET', { op: 'meta', school })).json.movedTo).toBe(
      'https://new.example/api',
    );
  });

  it('самопроверка хранилища не оставляет следов', async () => {
    const st = memoryStore();
    expect((await call(st, 'GET', { op: 'selftest' })).json).toEqual({
      ok: true,
      write: true,
      delete: true,
    });
    expect(st.m.size).toBe(0);
  });

  it('CORS и ошибки ввода', async () => {
    const st = memoryStore();
    const opt = await handle({ httpMethod: 'OPTIONS', queryStringParameters: { op: 'meta' } }, st);
    expect(opt.statusCode).toBe(204);
    expect(opt.headers['Access-Control-Allow-Origin']).toBe('*');
    expect((await call(st, 'GET', { op: 'meta', school: '../../etc' })).status).toBe(400);
    expect((await call(st, 'GET', { op: 'nope', school: 'abcdefgh' })).status).toBe(404);
  });
});
