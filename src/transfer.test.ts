import { describe, expect, it } from 'vitest';
import { emptyData, type AppData } from './domain';
import {
  QR_CAPACITY,
  TRANSFER_PREFIX,
  base45decode,
  base45encode,
  decodeTransfer,
  encodeTransfer,
} from './transfer';
describe('Base45', () => {
  it('совпадает с примерами RFC 9285', () => {
    expect(base45encode(new TextEncoder().encode('AB'))).toBe('BB8');
    expect(base45encode(new TextEncoder().encode('Hello!!'))).toBe('%69 VD92EX0');
    expect(new TextDecoder().decode(base45decode('QED8WEX0'))).toBe('ietf!');
  });
  it('отклоняет чужие символы и обрезанный текст', () => {
    expect(() => base45decode('abc')).toThrow();
    expect(() => base45decode('BB8B')).toThrow();
  });
});
describe('перенос через QR-код', () => {
  const week = (): AppData => {
    const data = emptyData();
    const classes = ['5А', '6Б', '7В', '8А', '9Б', '10А', '11В'];
    for (let day = 1; day <= 5; day++)
      for (let n = 1; n <= 7; n++)
        data.lessons.push({
          id: `${day}-${n}`,
          weekday: day,
          lessonNumber: n,
          className: classes[(day + n) % 7],
          subject: 'Информатика',
          room: '21',
        });
    data.bells = Array.from({ length: 7 }, (_, i) => {
      const start = 8 * 60 + i * 55;
      const t = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return { lessonNumber: i + 1, start: t(start), end: t(start + 45) };
    });
    data.holidays = [
      { id: 'a', title: 'Осенние каникулы', start: '2026-10-26', end: '2026-11-03' },
      { id: 'b', title: 'Зимние каникулы', start: '2026-12-29', end: '2027-01-11' },
    ];
    data.notes = [
      { date: '2026-09-01', lessonNumber: 1, text: 'давно прошло' },
      { date: '2026-09-29', lessonNumber: 3, text: 'контрольная, распечатать 28 вариантов' },
    ];
    return data;
  };
  it('полная неделя помещается в один QR-код и возвращается без потерь', async () => {
    const data = week();
    const text = await encodeTransfer(data, new Date(2026, 8, 28));
    expect(text.startsWith(TRANSFER_PREFIX)).toBe(true);
    // Полная неделя — небольшой QR-код, который легко читается с экрана.
    expect(text.length).toBeLessThan(QR_CAPACITY / 4);
    const back = await decodeTransfer(text);
    expect(back.lessons).toEqual(data.lessons);
    expect(back.bells).toEqual(data.bells);
    expect(back.holidays.map(({ id: _, ...h }) => h)).toEqual(
      data.holidays.map(({ id: _, ...h }) => h),
    );
    expect(back.notes).toEqual([data.notes[1]]);
  });
  it('понятно отказывает на чужом или повреждённом коде', async () => {
    await expect(decodeTransfer('https://example.com')).rejects.toThrow('не QR-код Помощника');
    const text = await encodeTransfer(week(), new Date(2026, 8, 28));
    await expect(decodeTransfer(text.slice(0, -20))).rejects.toThrow('прочитан не полностью');
  });
});
describe('QR-код на экране', () => {
  it('сканер читает отрисованный код без потерь', async () => {
    const { default: qrcode } = await import('qrcode-generator');
    const { default: jsQR } = await import('jsqr');
    const data = emptyData();
    for (let n = 1; n <= 7; n++)
      data.lessons.push({
        id: `1-${n}`,
        weekday: 1,
        lessonNumber: n,
        className: `${n + 4}Б`,
        subject: 'Информатика',
        room: '21',
      });
    const text = await encodeTransfer(data, new Date(2026, 8, 28));
    // Так же, как на экране компьютера: коррекция L, поле в 4 модуля.
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Alphanumeric');
    qr.make();
    const scale = 4;
    const size = (qr.getModuleCount() + 8) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const r = Math.floor(y / scale) - 4;
        const c = Math.floor(x / scale) - 4;
        const n = qr.getModuleCount();
        if (r >= 0 && c >= 0 && r < n && c < n && qr.isDark(r, c))
          pixels.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
      }
    const read = jsQR(pixels, size, size);
    expect(read?.data).toBe(text);
    expect((await decodeTransfer(read!.data)).lessons).toEqual(data.lessons);
  });
});
