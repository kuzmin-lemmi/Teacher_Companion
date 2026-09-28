import { decode, isoDate, type AppData } from './domain';
/**
 * Перенос расписания с компьютера на телефон одним QR-кодом.
 * JSON сжимается (deflate) и записывается в Base45 (RFC 9285): эти 45 символов QR-код
 * хранит в «буквенно-цифровом» режиме — плотнее, чем произвольный текст.
 */
export const TRANSFER_PREFIX = 'TC1:';
/** Предел одного QR-кода в буквенно-цифровом режиме (версия 40, коррекция L). */
export const QR_CAPACITY = 4296;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
export function base45encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const n = bytes[i] * 256 + bytes[i + 1];
    out += ALPHABET[n % 45] + ALPHABET[Math.floor(n / 45) % 45] + ALPHABET[Math.floor(n / 2025)];
  }
  if (bytes.length % 2) {
    const n = bytes[bytes.length - 1];
    out += ALPHABET[n % 45] + ALPHABET[Math.floor(n / 45)];
  }
  return out;
}
export function base45decode(text: string): Uint8Array {
  const values = [...text].map((ch) => {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('bad char');
    return v;
  });
  if (values.length % 3 === 1) throw new Error('bad length');
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 3) {
    const [c, d, e] = values.slice(i, i + 3);
    if (e === undefined) {
      const n = c + d * 45;
      if (n > 255) throw new Error('bad value');
      out.push(n);
    } else {
      const n = c + d * 45 + e * 2025;
      if (n > 65535) throw new Error('bad value');
      out.push(n >> 8, n & 255);
    }
  }
  return new Uint8Array(out);
}
async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const piped = new Response(bytes as unknown as BodyInit).body!.pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}
/**
 * Что уходит на телефон: расписание, звонки, календарь, настройки и заметки с сегодняшнего дня.
 * Прошедшие заметки не нужны, а место в QR-коде ограничено. Случайные идентификаторы
 * почти не сжимаются и занимают больше половины кода — телефон создаёт их заново.
 */
export async function encodeTransfer(data: AppData, today = new Date()): Promise<string> {
  const from = isoDate(today);
  const { onboardingComplete: _, ...rest } = data;
  const payload = {
    ...rest,
    lessons: data.lessons.map(({ id: _id, ...lesson }) => lesson),
    holidays: data.holidays.map(({ id: _id, ...holiday }) => holiday),
    notes: data.notes.filter((n) => n.date >= from),
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return TRANSFER_PREFIX + base45encode(await through(json, new CompressionStream('deflate-raw')));
}
export async function decodeTransfer(text: string): Promise<AppData> {
  const value = text.trim();
  if (!value.startsWith(TRANSFER_PREFIX))
    throw new Error(
      'Это не QR-код Помощника учителя. Откройте на компьютере «Перенос на телефон».',
    );
  let parsed: Omit<AppData, 'lessons' | 'holidays'> & {
    lessons?: Omit<AppData['lessons'][number], 'id'>[];
    holidays?: Omit<AppData['holidays'][number], 'id'>[];
  };
  try {
    const packed = base45decode(value.slice(TRANSFER_PREFIX.length));
    const bytes = await through(packed, new DecompressionStream('deflate-raw'));
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('QR-код прочитан не полностью. Попробуйте ещё раз, поднеся телефон ближе.');
  }
  // День и номер урока уникальны — из них получается устойчивый идентификатор.
  return decode(
    JSON.stringify({
      ...parsed,
      lessons: parsed.lessons?.map((l) => ({ ...l, id: `${l.weekday}-${l.lessonNumber}` })),
      holidays: parsed.holidays?.map((h, i) => ({ ...h, id: `h${i + 1}` })),
    }),
  );
}
