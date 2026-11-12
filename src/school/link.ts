/**
 * Ссылка подключения к школе — то, что лежит в QR-коде и в коде для компьютера.
 *
 *   tcs:1?s=<номер школы>&k=<ключ школы>&c=<контроль>            — сервер по умолчанию
 *   tcs:1?u=<адрес сервера>&s=…&k=…&c=…                          — другой сервер
 *
 * Без ФИО и паролей: адрес сервера, номер школы и ключ, которым расшифровывается расписание.
 * `c` — 4 символа контрольной суммы: если код вставили с опечаткой, это видно сразу.
 * Ключ завуча для отправки (publishToken) сюда не попадает никогда.
 */
import { fromB64url, SchoolKeyError } from './crypto';

/** Сервер пилота — Yandex Cloud Function. При переезде сервер сам сообщит приложениям новый адрес. */
export const DEFAULT_SERVER = 'https://functions.yandexcloud.net/d4e83mv6umt03na5f1f5';

export type SchoolLink = { server: string; school: string; key: string };

const SCHOOL_RE = /^[a-z0-9]{8,32}$/;

async function check(server: string, school: string, key: string): Promise<string> {
  const d = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${server}|${school}|${key}`),
  );
  return [...new Uint8Array(d).slice(0, 3)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 4);
}

export async function encodeSchoolLink(link: SchoolLink): Promise<string> {
  const q = new URLSearchParams();
  if (link.server !== DEFAULT_SERVER) q.set('u', link.server);
  q.set('s', link.school);
  q.set('k', link.key);
  q.set('c', await check(link.server, link.school, link.key));
  return `tcs:1?${q.toString()}`;
}

/** Разбор кода из QR или вставленного текста. Пробелы и переносы, добавленные мессенджером, игнорируются. */
export async function parseSchoolLink(text: string): Promise<SchoolLink> {
  const t = text.replace(/\s+/g, '');
  const m = /^tcs:1\?(.+)$/.exec(t);
  if (!m) throw new SchoolKeyError('Это не QR-код школы. Отсканируйте лист из учительской.');
  const q = new URLSearchParams(m[1]);
  const server = q.get('u') ?? DEFAULT_SERVER;
  const school = q.get('s') ?? '';
  const key = q.get('k') ?? '';
  if (!/^https:\/\//.test(server)) throw new SchoolKeyError('В коде школы неверный адрес сервера.');
  if (!SCHOOL_RE.test(school)) throw new SchoolKeyError('В коде школы неверный номер школы.');
  let keyOk = false;
  try {
    keyOk = fromB64url(key).length === 32;
  } catch {
    keyOk = false;
  }
  if (!keyOk)
    throw new SchoolKeyError('Код школы повреждён: проверьте, что он скопирован целиком.');
  if (q.get('c') !== (await check(server, school, key)))
    throw new SchoolKeyError('Код школы с опечаткой: скопируйте его заново или отсканируйте QR.');
  return { server, school, key };
}
