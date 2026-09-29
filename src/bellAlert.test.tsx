// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useBellAlert } from './bellAlert';
import { emptyData, type Countdown, type Day, type Lesson } from './domain';

const chime = vi.hoisted(() => ({ playChime: vi.fn(), showSystemNotification: vi.fn() }));
vi.mock('./chime', () => chime);

const lesson = { id: 'l1', lessonNumber: 3, className: '7Б' } as Lesson;
const day = {
  lessons: [lesson],
  time: () => ({ start: '10:00', end: '10:45' }),
} as unknown as Day;
const timer = (minutes: number): Countdown => ({
  kind: 'lesson',
  lessonId: 'l1',
  minutes,
  progress: 0.9,
});
const data = (patch = {}) => {
  const d = emptyData();
  return { ...d, settings: { ...d.settings, ...patch } };
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('useBellAlert', () => {
  it('stays quiet while more than N minutes remain', () => {
    const { result } = renderHook(() => useBellAlert(data(), day, timer(20), '2026-09-29'));
    expect(result.current.activeAlert).toBeNull();
    expect(chime.playChime).not.toHaveBeenCalled();
  });

  it('alerts once per lesson and day, with sound and notification', () => {
    const { result, rerender } = renderHook(({ t }) => useBellAlert(data(), day, t, '2026-09-29'), {
      initialProps: { t: timer(5) },
    });
    expect(result.current.activeAlert).toMatchObject({
      lessonNumber: 3,
      className: '7Б',
      minutes: 5,
    });
    expect(chime.playChime).toHaveBeenCalledTimes(1);
    expect(chime.showSystemNotification).toHaveBeenCalledTimes(1);
    rerender({ t: timer(4) });
    expect(result.current.activeAlert?.minutes).toBe(4);
    expect(chime.playChime).toHaveBeenCalledTimes(1);
  });

  it('respects sound/popup settings and can be dismissed', () => {
    const { result } = renderHook(() =>
      useBellAlert(data({ bellAlertSound: false, bellAlertPopup: false }), day, timer(3), 'd'),
    );
    expect(result.current.activeAlert).not.toBeNull();
    expect(chime.playChime).not.toHaveBeenCalled();
    expect(chime.showSystemNotification).not.toHaveBeenCalled();
    act(() => result.current.dismissAlert());
    expect(result.current.activeAlert).toBeNull();
  });

  it('is off when minutes is 0 or outside a lesson', () => {
    const off = renderHook(() => useBellAlert(data({ bellAlertMinutes: 0 }), day, timer(1), 'd'));
    expect(off.result.current.activeAlert).toBeNull();
    const brk = renderHook(() =>
      useBellAlert(data(), day, { kind: 'break', lessonId: 'l1', minutes: 2 }, 'd'),
    );
    expect(brk.result.current.activeAlert).toBeNull();
  });
});
