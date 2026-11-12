import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, generateSchoolKey, SchoolKeyError } from './crypto';
import { DEFAULT_SERVER, encodeSchoolLink, parseSchoolLink } from './link';

const school = 'abcd1234efgh5678';

describe('шифрование расписания', () => {
  it('туда и обратно, со сжатием', async () => {
    const key = generateSchoolKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const value = {
      hello: 'Расписание 7Б',
      lessons: Array.from({ length: 300 }, (_, i) => ({ n: i, s: 'Математика' })),
    };
    const blob = await encryptJson(value, key, school);
    expect(blob.startsWith('tcs1.g.')).toBe(true);
    expect(blob.length).toBeLessThan(JSON.stringify(value).length / 4); // gzip работает
    expect(blob).not.toContain('Математика');
    expect(await decryptJson(blob, key, school)).toEqual(value);
  });

  it('каждый раз новый IV — одинаковые данные дают разный шифротекст', async () => {
    const key = generateSchoolKey();
    expect(await encryptJson({ a: 1 }, key, school)).not.toBe(
      await encryptJson({ a: 1 }, key, school),
    );
  });

  it('чужой ключ, чужая школа, подмена байтов — понятная ошибка', async () => {
    const key = generateSchoolKey();
    const blob = await encryptJson({ a: 1 }, key, school);
    await expect(decryptJson(blob, generateSchoolKey(), school)).rejects.toThrow(
      'Ключ школы не подходит',
    );
    await expect(decryptJson(blob, key, 'zzzz1234efgh5678')).rejects.toBeInstanceOf(SchoolKeyError);
    const parts = blob.split('.');
    const ct = parts[3];
    const flipped = (ct[5] === 'A' ? 'B' : 'A') + '';
    const tampered = [...parts.slice(0, 3), ct.slice(0, 5) + flipped + ct.slice(6)].join('.');
    await expect(decryptJson(tampered, key, school)).rejects.toThrow('Ключ школы не подходит');
    await expect(decryptJson('мусор', key, school)).rejects.toThrow('Неизвестный формат');
    await expect(decryptJson(blob, 'короткий', school)).rejects.toBeInstanceOf(SchoolKeyError);
  });
});

describe('код подключения к школе (QR)', () => {
  it('туда и обратно; сервер по умолчанию не пишется в код', async () => {
    const link = { server: DEFAULT_SERVER, school, key: generateSchoolKey() };
    const code = await encodeSchoolLink(link);
    expect(code).toMatch(/^tcs:1\?s=abcd1234efgh5678&k=[A-Za-z0-9_-]{43}&c=[0-9a-f]{4}$/);
    expect(code.length).toBeLessThan(90);
    expect(await parseSchoolLink(code)).toEqual(link);
  });

  it('другой сервер — адрес в коде', async () => {
    const link = { server: 'https://example.ru/api', school, key: generateSchoolKey() };
    expect(await parseSchoolLink(await encodeSchoolLink(link))).toEqual(link);
  });

  it('мессенджер разбил код переносами — всё равно читается', async () => {
    const code = await encodeSchoolLink({
      server: DEFAULT_SERVER,
      school,
      key: generateSchoolKey(),
    });
    const broken = `${code.slice(0, 20)}\n${code.slice(20, 50)} ${code.slice(50)}`;
    expect((await parseSchoolLink(broken)).school).toBe(school);
  });

  it('опечатка и чужие QR — понятные ошибки', async () => {
    const code = await encodeSchoolLink({
      server: DEFAULT_SERVER,
      school,
      key: generateSchoolKey(),
    });
    const i = code.indexOf('k=') + 5;
    const typo = code.slice(0, i) + (code[i] === 'x' ? 'y' : 'x') + code.slice(i + 1);
    await expect(parseSchoolLink(typo)).rejects.toThrow('опечаткой');
    await expect(parseSchoolLink('https://vk.com/club1')).rejects.toThrow('Это не QR-код школы');
    await expect(parseSchoolLink(code.replace('k=', 'k=AA'))).rejects.toThrow('повреждён');
    await expect(parseSchoolLink('tcs:1?u=http://x&s=abcd1234efgh5678&k=a&c=0000')).rejects.toThrow(
      'адрес сервера',
    );
  });
});
