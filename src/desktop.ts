import { isTauri, invoke } from '@tauri-apps/api/core';
import type { Settings } from './domain';
import { safePosition, type Point } from './geometry';
export type Surface = 'widget' | 'settings';
let surface: Surface = 'settings';
let switching = false;
let lastPlaced: Point | null = null;
let queue = Promise.resolve();
const positionKey = 'teacher-companion-widget-position-v2';
function readPosition(): Point | null {
  try {
    const p = JSON.parse(localStorage.getItem(positionKey) ?? 'null');
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}
function writePosition(p: Point) {
  localStorage.setItem(positionKey, JSON.stringify({ x: p.x, y: p.y }));
}
export async function syncAutostart(enabled: boolean) {
  if (!isTauri()) return;
  const api = await import('@tauri-apps/plugin-autostart');
  if ((await api.isEnabled()) !== enabled) await (enabled ? api.enable() : api.disable());
}
export async function showWindow() {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    await w.unminimize();
    await w.show();
    await w.setFocus();
  }
}
export async function hideWindow() {
  if (isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  }
}
export async function exitApp() {
  if (isTauri()) {
    await invoke('quit_app');
  }
}
export async function startDrag(locked: boolean) {
  if (!locked && isTauri()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
  }
}
export async function resetPosition() {
  localStorage.removeItem(positionKey);
}
export function configureWindow(
  next: Surface,
  settings: Settings,
  contentHeight?: number,
): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  const operation = queue
    .catch(() => {})
    .then(async () => {
      const {
        getCurrentWindow,
        LogicalSize,
        PhysicalSize,
        PhysicalPosition,
        availableMonitors,
        primaryMonitor,
      } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      switching = true;
      try {
        const changed = surface !== next;
        await w.setMinSize(
          new LogicalSize(next === 'widget' ? 200 : 680, next === 'widget' ? 100 : 500),
        );
        await w.setDecorations(next !== 'widget');
        // Без тени Windows не рисует рамку вокруг окна без заголовка.
        await w.setShadow(next !== 'widget');
        await w.setResizable(next !== 'widget');
        await w.setSkipTaskbar(next === 'widget');
        await w.setAlwaysOnTop(next === 'widget' && settings.alwaysOnTop);
        if (next === 'widget') {
          const monitors = await availableMonitors();
          const primary = await primaryMonitor();
          const ordered = primary
            ? [primary, ...monitors.filter((m) => m.name !== primary.name)]
            : monitors;
          // Сохранённая позиция есть только если учитель сам перетащил виджет.
          const saved = readPosition();
          const target =
            ordered.find(
              (m) =>
                saved &&
                saved.x >= m.workArea.position.x &&
                saved.x < m.workArea.position.x + m.workArea.size.width &&
                saved.y >= m.workArea.position.y &&
                saved.y < m.workArea.position.y + m.workArea.size.height,
            ) ?? ordered[0];
          const width = settings.widgetSize === 'compact' ? 232 : 332;
          const preferred = contentHeight || (settings.widgetSize === 'compact' ? 300 : 340);
          if (target) {
            const scale = target.scaleFactor;
            const height = Math.max(
              100,
              Math.min(preferred, target.workArea.size.height / scale - 32),
            );
            const size = { width: Math.round(width * scale), height: Math.round(height * scale) };
            const areas = [target, ...ordered.filter((m) => m !== target)].map((m) => ({
              ...m.workArea.position,
              width: m.workArea.size.width,
              height: m.workArea.size.height,
            }));
            await w.setSize(new PhysicalSize(size.width, size.height));
            // Внешний размер учитывает невидимую рамку Windows вокруг окна.
            const outer = await w.outerSize();
            const pos = safePosition(
              saved,
              { width: outer.width, height: outer.height },
              areas,
              settings.widgetCorner,
              Math.round(16 * scale),
            );
            lastPlaced = pos;
            await w.setPosition(new PhysicalPosition(pos.x, pos.y));
          } else await w.setSize(new LogicalSize(width, preferred));
        } else if (changed) {
          await w.setSize(new LogicalSize(1180, 800));
          await w.center();
        }
        surface = next;
        await w.show();
      } finally {
        switching = false;
      }
    });
  queue = operation;
  return operation;
}
export async function subscribeDesktop(actions: {
  tray: (action: string) => void;
  close: () => void;
  movedError: () => void;
  displayChanged: () => void;
}) {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const { listen } = await import('@tauri-apps/api/event');
  const w = getCurrentWindow();
  const cleanups: (() => void)[] = [];
  try {
    cleanups.push(
      await w.onCloseRequested((e) => {
        e.preventDefault();
        actions.close();
      }),
    );
    cleanups.push(await listen<string>('tray-action', (e) => actions.tray(e.payload)));
    cleanups.push(
      await w.onMoved((e) => {
        const p = e.payload;
        const programmatic =
          lastPlaced && Math.abs(p.x - lastPlaced.x) <= 2 && Math.abs(p.y - lastPlaced.y) <= 2;
        if (surface === 'widget' && !switching && !programmatic) {
          try {
            writePosition(e.payload);
          } catch {
            actions.movedError();
          }
        }
      }),
    );
    cleanups.push(
      await w.onScaleChanged(() => {
        if (!switching) actions.displayChanged();
      }),
    );
    return () => cleanups.forEach((fn) => fn());
  } catch (error) {
    cleanups.forEach((fn) => fn());
    throw error;
  }
}
