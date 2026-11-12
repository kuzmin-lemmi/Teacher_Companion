/**
 * Клиент сервера расписания школы (server/yandex). Общий для «Бланков» и Teacher Companion.
 * Сервер видит только зашифрованное: шифрование и расшифровка — здесь, на устройстве.
 */
import { decryptJson, encryptJson } from './crypto';
import type { SchoolLink } from './link';
import { assertPublication, type Publication } from './publication';

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

type Opts = { method?: string; school?: string; token?: string; body?: unknown };

async function call<T>(server: string, op: string, o: Opts = {}): Promise<T> {
  const url = new URL(server);
  url.searchParams.set('op', op);
  if (o.school) url.searchParams.set('school', o.school);
  let r: Response;
  try {
    r = await fetch(url, {
      method: o.method ?? 'GET',
      headers: {
        ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        // Не Authorization: его перехватывает шлюз Yandex Cloud Functions (ответ 403).
        ...(o.token ? { 'X-School-Token': o.token } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      cache: 'no-store',
    });
  } catch {
    throw new ServerError(
      'Нет связи с сервером расписания. Проверьте интернет и попробуйте ещё раз.',
    );
  }
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok)
    throw new ServerError(data.error || `Сервер расписания ответил ошибкой ${r.status}.`, r.status);
  return data;
}

export type Meta = { version: number; publishedAt: string | null; movedTo?: string };
export type Fetched = {
  version: number;
  publishedAt: string;
  publication: Publication;
  movedTo?: string;
};

export const schoolApi = {
  health: (server: string) => call<{ ok: boolean }>(server, 'health'),

  /** Подключение школы: только один раз, пока школ на сервере нет. */
  setup: (server: string, name: string) =>
    call<{ school: string; publishToken: string }>(server, 'setup', {
      method: 'POST',
      body: { name },
    }),

  meta: (link: Pick<SchoolLink, 'server' | 'school'>) =>
    call<Meta>(link.server, 'meta', { school: link.school }),

  /** Текущая публикация, расшифрованная. `null` — завуч ещё ничего не отправлял. */
  async fetch(link: SchoolLink): Promise<Fetched | null> {
    let r: { version: number; publishedAt: string; blob: string; movedTo?: string };
    try {
      r = await call(link.server, 'current', { school: link.school });
    } catch (e) {
      if (e instanceof ServerError && e.status === 404 && /не отправлено/.test(e.message))
        return null;
      throw e;
    }
    const publication = await decryptJson<unknown>(r.blob, link.key, link.school);
    assertPublication(publication);
    return {
      version: r.version,
      publishedAt: r.publishedAt,
      publication,
      ...(r.movedTo ? { movedTo: r.movedTo } : {}),
    };
  },

  async publish(link: SchoolLink, token: string, publication: Publication) {
    const blob = await encryptJson(publication, link.key, link.school);
    return call<{ version: number; publishedAt: string }>(link.server, 'publish', {
      method: 'PUT',
      school: link.school,
      token,
      body: { blob },
    });
  },

  rollback: (link: Pick<SchoolLink, 'server' | 'school'>, token: string) =>
    call<{ version: number; publishedAt: string }>(link.server, 'rollback', {
      method: 'POST',
      school: link.school,
      token,
    }),
};
