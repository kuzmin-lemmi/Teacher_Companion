// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const autostart = vi.hoisted(() => ({ fail: false, calls: [] as boolean[] }));
vi.mock('./desktop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./desktop')>()),
  syncAutostart: async (enabled: boolean) => {
    autostart.calls.push(enabled);
    if (autostart.fail) throw new Error('Автозапуск недоступен');
  },
}));
import { Shell } from './Shell';
import { emptyData, type AppData } from './domain';
import type { Storage } from './storage';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  autostart.fail = false;
  autostart.calls = [];
});
function memory(delay = 0) {
  const state = {
    data: {
      ...emptyData(),
      lessons: [
        { id: 'one', weekday: 5, lessonNumber: 1, className: '6А', subject: '', room: '' },
        { id: 'three', weekday: 5, lessonNumber: 3, className: '7Б', subject: '', room: '' },
      ],
      bells: [
        { lessonNumber: 1, start: '08:30', end: '09:15' },
        { lessonNumber: 3, start: '10:20', end: '11:05' },
      ],
    } as AppData,
  };
  const storage: Storage = {
    load: async () => state.data,
    save: async (value) => {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      state.data = value;
    },
  };
  return { state, storage };
}
it('сбой автозапуска не мешает сохранить заметку и закрепить виджет', async () => {
  autostart.fail = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 24, 12));
  const { state, storage } = memory();
  const user = userEvent.setup();
  render(<Shell storage={storage} updates={async () => null} />);
  await user.click(await screen.findByText('7Б'));
  await user.type(screen.getByLabelText('Заметка к уроку 3, 7Б'), 'контрольная{Enter}');
  await waitFor(() => expect(state.data.notes).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'Закрепить виджет' }));
  await waitFor(() => expect(state.data.settings.locked).toBe(true));
  expect(autostart.calls).toEqual([]);
});
it('автозапуск применяется, только когда меняют его самого; ошибка не даёт сохранить', async () => {
  const { state, storage } = memory();
  const user = userEvent.setup();
  render(<Shell storage={storage} updates={async () => null} />);
  await user.click(await screen.findByRole('button', { name: 'Открыть настройки' }));
  await user.click(await screen.findByText('Внешний вид'));
  await user.click(screen.getByLabelText(/Поверх других окон/));
  await user.click(screen.getByText('Сохранить настройки'));
  await screen.findByText('Настройки сохранены');
  expect(state.data.settings.alwaysOnTop).toBe(true);
  expect(autostart.calls).toEqual([]);
  autostart.fail = true;
  await user.click(screen.getByLabelText(/Запускать вместе с Windows/));
  await user.click(screen.getByText('Сохранить настройки'));
  await screen.findByText(/Не удалось сохранить данные или применить автозапуск/);
  expect(autostart.calls).toEqual([true]);
  expect(state.data.settings.launchOnStartup).toBe(false);
});
it('на телефоне быстрые нажатия подряд сохраняются по очереди и не теряются', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14)');
  const { state, storage } = memory(30);
  const user = userEvent.setup();
  render(<Shell storage={storage} updates={async () => null} />);
  await user.click(await screen.findByRole('button', { name: 'Настройки' }));
  await user.click(await screen.findByText('Внешний вид'));
  await user.click(screen.getByLabelText(/Светлая/));
  await user.click(screen.getByLabelText(/Подробно/));
  await waitFor(() =>
    expect(state.data.settings).toMatchObject({ theme: 'light', widgetSize: 'normal' }),
  );
  expect(screen.queryByRole('alert')).toBeNull();
});
