// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  enabled: false,
  enable: vi.fn(),
  disable: vi.fn(),
  isEnabled: vi.fn(),
  drag: vi.fn(),
  hide: vi.fn(),
  unminimize: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mock.invoke }));
vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: mock.enable,
  disable: mock.disable,
  isEnabled: mock.isEnabled,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: mock.drag,
    hide: mock.hide,
    unminimize: mock.unminimize,
    show: mock.show,
    setFocus: mock.focus,
  }),
}));
import {
  configureWindow,
  exitApp,
  hideWindow,
  isDesktop,
  showWindow,
  startDrag,
  syncAutostart,
} from './desktop';
import { emptyData } from './domain';
beforeEach(() => {
  vi.clearAllMocks();
  mock.isEnabled.mockResolvedValue(false);
});
it('включает автозапуск только при изменении значения', async () => {
  await syncAutostart(true);
  expect(mock.enable).toHaveBeenCalledOnce();
  mock.isEnabled.mockResolvedValue(true);
  await syncAutostart(true);
  expect(mock.enable).toHaveBeenCalledOnce();
  await syncAutostart(false);
  expect(mock.disable).toHaveBeenCalledOnce();
});
it('передаёт ошибку автозапуска вызывающему коду', async () => {
  mock.enable.mockRejectedValueOnce(new Error('denied'));
  await expect(syncAutostart(true)).rejects.toThrow('denied');
});
it('закреплённый виджет нельзя перетащить', async () => {
  await startDrag(true);
  expect(mock.drag).not.toHaveBeenCalled();
  await startDrag(false);
  expect(mock.drag).toHaveBeenCalledOnce();
});
it('различает скрытие, показ и полное завершение', async () => {
  await hideWindow();
  expect(mock.hide).toHaveBeenCalledOnce();
  expect(mock.invoke).not.toHaveBeenCalled();
  await showWindow();
  expect(mock.unminimize).toHaveBeenCalledOnce();
  expect(mock.show).toHaveBeenCalledOnce();
  expect(mock.focus).toHaveBeenCalledOnce();
  await exitApp();
  expect(mock.invoke).toHaveBeenCalledWith('quit_app');
});
it('на Android окно, трей и автозапуск не трогает', async () => {
  const agent = vi
    .spyOn(navigator, 'userAgent', 'get')
    .mockReturnValue(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile',
    );
  try {
    expect(isDesktop()).toBe(false);
    await syncAutostart(true);
    await startDrag(false);
    await hideWindow();
    await showWindow();
    await configureWindow('widget', emptyData().settings, 300);
    expect(mock.isEnabled).not.toHaveBeenCalled();
    expect(mock.enable).not.toHaveBeenCalled();
    expect(mock.drag).not.toHaveBeenCalled();
    expect(mock.hide).not.toHaveBeenCalled();
    expect(mock.show).not.toHaveBeenCalled();
  } finally {
    agent.mockRestore();
  }
});
