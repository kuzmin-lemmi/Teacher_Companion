/**
 * Шифрование расписания школы ключом из QR-кода. AES-GCM 256 через WebCrypto —
 * есть и в браузере завуча, и в WebView Teacher Companion (Windows, Android), и в Node.
 *
 * Формат строки: `tcs1.<g|r>.<iv>.<шифротекст>` (base64url).
 *   g — внутри JSON, сжатый gzip; r — без сжатия (если CompressionStream недоступен).
 * Номер школы входит в «дополнительные данные» AES-GCM: расписание одной школы
 * не расшифруется как расписание другой, а любая подмена байтов обнаружится.
 */

export class SchoolKeyError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text))
    throw new SchoolKeyError('Повреждённые данные: недопустимые символы.');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Новый ключ школы: 32 случайных байта, base64url (43 символа). */
export function generateSchoolKey(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function importKey(key: string, usage: KeyUsage): Promise<CryptoKey> {
  const raw = fromB64url(key);
  if (raw.length !== 32)
    throw new SchoolKeyError('Ключ школы повреждён: проверьте QR-код или код подключения.');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [usage]);
}

const aad = (school: string) => enc.encode(`tc-school|${school}`);

async function pipe(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  // Поток из байтов вручную: у Blob.stream() нет поддержки в старых WebView и в jsdom.
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(data);
      c.close();
    },
  });
  const out = new Response(
    source.pipeThrough(stream as unknown as TransformStream<Uint8Array, Uint8Array>),
  );
  return new Uint8Array(await out.arrayBuffer());
}

const canGzip = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function encryptJson(value: unknown, key: string, school: string): Promise<string> {
  const k = await importKey(key, 'encrypt');
  let data: Uint8Array = enc.encode(JSON.stringify(value));
  const gz = canGzip();
  if (gz) data = await pipe(data, new CompressionStream('gzip'));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(school) },
      k,
      data as BufferSource,
    ),
  );
  return `tcs1.${gz ? 'g' : 'r'}.${toB64url(iv)}.${toB64url(ct)}`;
}

export async function decryptJson<T = unknown>(
  blob: string,
  key: string,
  school: string,
): Promise<T> {
  const [ver, mode, ivText, ctText] = blob.split('.');
  if (ver !== 'tcs1' || (mode !== 'g' && mode !== 'r') || !ivText || !ctText)
    throw new SchoolKeyError('Неизвестный формат расписания — обновите приложение.');
  const k = await importKey(key, 'decrypt');
  let data: Uint8Array;
  try {
    data = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64url(ivText) as BufferSource, additionalData: aad(school) },
        k,
        fromB64url(ctText) as BufferSource,
      ),
    );
  } catch {
    throw new SchoolKeyError('Ключ школы не подходит: отсканируйте QR-код школы заново.');
  }
  if (mode === 'g') {
    if (!canGzip())
      throw new SchoolKeyError(
        'Это устройство не умеет распаковывать расписание — обновите WebView.',
      );
    data = await pipe(data, new DecompressionStream('gzip'));
  }
  return JSON.parse(dec.decode(data)) as T;
}
