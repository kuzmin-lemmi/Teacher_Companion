/**
 * Точка входа Yandex Cloud Function. Хранилище — Object Storage, доступ по IAM-токену
 * сервисного аккаунта функции (context.token): статических ключей нет нигде.
 * Переменная окружения BUCKET — имя бакета.
 */
import { handle } from './handler.mjs';

const ENDPOINT = 'https://storage.yandexcloud.net';

function objectStore(bucket, token) {
  const url = (key) => `${ENDPOINT}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;
  const auth = { 'X-YaCloud-SubjectToken': token };
  return {
    async get(key) {
      const r = await fetch(url(key), { headers: auth });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`storage get ${key}: ${r.status}`);
      return r.text();
    },
    async put(key, text) {
      const r = await fetch(url(key), {
        method: 'PUT',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: text,
      });
      if (!r.ok) throw new Error(`storage put ${key}: ${r.status} ${await r.text()}`);
    },
    async del(key) {
      const r = await fetch(url(key), { method: 'DELETE', headers: auth });
      if (!r.ok && r.status !== 404) throw new Error(`storage delete ${key}: ${r.status}`);
    },
  };
}

export async function handler(event, context) {
  try {
    const token = context?.token?.access_token;
    if (!token) throw new Error('У функции нет сервисного аккаунта');
    return await handle(event, objectStore(process.env.BUCKET, token));
  } catch (e) {
    console.error(e);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Ошибка сервера' }),
    };
  }
}
