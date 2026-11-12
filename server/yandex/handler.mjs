/**
 * Сервер расписания школы: Yandex Cloud Function, без зависимостей.
 *
 * Хранит ТОЛЬКО зашифрованные версии расписания: ключ шифрования есть у «Бланков» завуча
 * и в QR-коде школы, сервер его не видит. Адрес функции один, операция — в ?op=…
 *
 *   GET  ?op=health                         — жив ли сервер
 *   POST ?op=setup                          — первая школа (только пока школ нет) → { school, publishToken }
 *   GET  ?op=meta&school=ID                 — { version, publishedAt, movedTo? } — дёшево, для проверки «есть ли новее»
 *   GET  ?op=current&school=ID              — { version, publishedAt, blob }
 *   PUT  ?op=publish&school=ID   (Bearer)   — тело { version, publishedAt, blob } → новая версия
 *   POST ?op=rollback&school=ID  (Bearer)   — вернуть предыдущую версию
 *   POST ?op=move&school=ID      (Bearer)   — тело { movedTo } — приложения переедут на новый адрес сами
 *
 * Хранилище передаётся снаружи (store.get/put/del) — в облаке это Object Storage, в тестах — Map.
 */

const KEEP = 10;
const MAX_BLOB = 5 * 1024 * 1024;
const ID_RE = /^[a-z0-9]{8,32}$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const reply = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...CORS,
    ...extra,
  },
  body: JSON.stringify(body),
});
const fail = (statusCode, error) => reply(statusCode, { error });

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return b64url(new Uint8Array(d));
}

function readBody(event) {
  if (!event.body) return null;
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function bearer(event) {
  const h = event.headers ?? {};
  const v = h.Authorization ?? h.authorization ?? '';
  return v.startsWith('Bearer ') ? v.slice(7) : '';
}

/** Ключи в хранилище. */
const K = {
  index: 'schools.json',
  school: (id) => `schools/${id}/school.json`,
  meta: (id) => `schools/${id}/meta.json`,
  version: (id, v) => `schools/${id}/v/${String(v).padStart(8, '0')}.json`,
};

const getJson = async (store, key) => {
  const t = await store.get(key);
  return t == null ? null : JSON.parse(t);
};
const putJson = (store, key, v) => store.put(key, JSON.stringify(v));

async function authorized(store, id, event) {
  const school = await getJson(store, K.school(id));
  if (!school) return { error: fail(404, 'Школа не найдена') };
  const token = bearer(event);
  if (!token || (await sha256(token)) !== school.tokenHash)
    return { error: fail(403, 'Неверный ключ завуча') };
  return { school };
}

export async function handle(event, store, now = () => new Date()) {
  const method = (event.httpMethod ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const q = event.queryStringParameters ?? {};
  const op = q.op ?? 'health';
  const id = q.school ?? '';

  if (op === 'health')
    return reply(200, { ok: true, service: 'tc-school', time: now().toISOString() });

  if (op === 'setup' && method === 'POST') {
    const index = (await getJson(store, K.index)) ?? { schools: [] };
    // Пилот: создать можно только первую школу. Дальше — вручную в хранилище или новой версией функции.
    if (index.schools.length > 0)
      return fail(403, 'Школа уже подключена. Повторное подключение запрещено.');
    const body = readBody(event) ?? {};
    const school = b64url(crypto.getRandomValues(new Uint8Array(12)))
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 16);
    const publishToken = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const name = typeof body.name === 'string' ? body.name.slice(0, 120) : '';
    await putJson(store, K.school(school), {
      id: school,
      name,
      tokenHash: await sha256(publishToken),
      createdAt: now().toISOString(),
    });
    await putJson(store, K.meta(school), { version: 0, publishedAt: null, versions: [] });
    await putJson(store, K.index, { schools: [school] });
    return reply(200, { school, publishToken });
  }

  if (!ID_RE.test(id)) return fail(400, 'Нужен параметр school');

  if (op === 'meta' && method === 'GET') {
    const meta = await getJson(store, K.meta(id));
    if (!meta) return fail(404, 'Школа не найдена');
    return reply(200, {
      version: meta.version,
      publishedAt: meta.publishedAt,
      ...(meta.movedTo ? { movedTo: meta.movedTo } : {}),
    });
  }

  if (op === 'current' && method === 'GET') {
    const meta = await getJson(store, K.meta(id));
    if (!meta) return fail(404, 'Школа не найдена');
    if (!meta.version) return fail(404, 'Расписание ещё не отправлено');
    const v = await getJson(store, K.version(id, meta.version));
    if (!v) return fail(500, 'Версия расписания не найдена в хранилище');
    return reply(200, {
      version: meta.version,
      publishedAt: v.publishedAt,
      blob: v.blob,
      ...(meta.movedTo ? { movedTo: meta.movedTo } : {}),
    });
  }

  if (op === 'publish' && method === 'PUT') {
    const { error } = await authorized(store, id, event);
    if (error) return error;
    const body = readBody(event);
    if (!body || typeof body.blob !== 'string' || !body.blob)
      return fail(400, 'Нет зашифрованного расписания (blob)');
    if (body.blob.length > MAX_BLOB) return fail(413, 'Слишком большой файл расписания');
    const meta = (await getJson(store, K.meta(id))) ?? { version: 0, versions: [] };
    const version = (meta.version || 0) + 1;
    const publishedAt = now().toISOString();
    await putJson(store, K.version(id, version), { version, publishedAt, blob: body.blob });
    const versions = [...(meta.versions ?? []).filter((x) => x !== version), version];
    while (versions.length > KEEP) await store.del(K.version(id, versions.shift()));
    await putJson(store, K.meta(id), { ...meta, version, publishedAt, versions });
    return reply(200, { version, publishedAt });
  }

  if (op === 'rollback' && method === 'POST') {
    const { error } = await authorized(store, id, event);
    if (error) return error;
    const meta = await getJson(store, K.meta(id));
    const versions = [...(meta?.versions ?? [])];
    if (versions.length < 2) return fail(409, 'Откатывать некуда: есть только одна версия');
    await store.del(K.version(id, versions.pop()));
    const prev = await getJson(store, K.version(id, versions[versions.length - 1]));
    // Номер версии не уменьшаем — иначе приложения не заметят перемену. Предыдущая версия публикуется заново.
    const version = meta.version + 1;
    const publishedAt = now().toISOString();
    await putJson(store, K.version(id, version), {
      version,
      publishedAt,
      blob: prev.blob,
      rolledBackFrom: meta.version,
    });
    versions.push(version);
    await putJson(store, K.meta(id), { ...meta, version, publishedAt, versions });
    return reply(200, { version, publishedAt, restored: versions[versions.length - 2] });
  }

  if (op === 'move' && method === 'POST') {
    const { error } = await authorized(store, id, event);
    if (error) return error;
    const body = readBody(event) ?? {};
    if (typeof body.movedTo !== 'string' || !/^https:\/\//.test(body.movedTo))
      return fail(400, 'Нужен новый адрес https://…');
    const meta = await getJson(store, K.meta(id));
    await putJson(store, K.meta(id), { ...meta, movedTo: body.movedTo });
    return reply(200, { movedTo: body.movedTo });
  }

  return fail(404, 'Неизвестная операция');
}
