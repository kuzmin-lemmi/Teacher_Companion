import { describe, expect, it } from 'vitest';
import { fitSize } from './geometry';
describe('размер окна настроек', () => {
  const want = { width: 1180, height: 800 };
  it('на большом экране остаётся желаемым', () => {
    expect(fitSize(want, { width: 2560, height: 1400 }, 1)).toEqual(want);
  });
  it('на проекторе 1024×768 не больше экрана', () => {
    const size = fitSize(want, { width: 1024, height: 728 }, 1);
    expect(size.width).toBeLessThanOrEqual(1024);
    expect(size.height).toBeLessThanOrEqual(728);
    expect(size.width).toBeGreaterThanOrEqual(640);
  });
  it('учитывает масштаб Windows', () => {
    // 1920×1040 физических пикселей при 150% — это 1280×693 логических.
    const size = fitSize(want, { width: 1920, height: 1040 }, 1.5);
    expect(size.width).toBeLessThanOrEqual(1280);
    expect(size.height).toBeLessThanOrEqual(693);
  });
  it('минимум не выталкивает окно за экран', () => {
    expect(fitSize(want, { width: 600, height: 400 }, 1)).toEqual({ width: 600, height: 400 });
  });
});
