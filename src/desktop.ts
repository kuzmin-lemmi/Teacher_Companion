import { isTauri, invoke } from '@tauri-apps/api/core';
import type { Settings } from './domain';
import { safePosition, type Point } from './geometry';
export type Surface = 'widget' | 'settings';
let surface: Surface = 'settings';
let switching = false;
let queue = Promise.resolve();
const positionKey = 'teacher-companion-widget-position-v1';
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
export function configureWindow(next: Surface, settings: Settings): Promise<void> {
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
        if (surface === 'widget' && next !== 'widget') writePosition(await w.outerPosition());
        const changed = surface !== next;
        await w.setMinSize(
          new LogicalSize(next === 'widget' ? 280 : 680, next === 'widget' ? 220 : 500),
        );
        await w.setDecorations(next !== 'widget');
        await w.setResizable(next !== 'widget');
        await w.setSkipTaskbar(next === 'widget');
        await w.setAlwaysOnTop(next === 'widget' && settings.alwaysOnTop);
        if (next === 'widget') {
          const monitors = await availableMonitors();
          const primary = await primaryMonitor();
          const ordered = primary
            ? [primary, ...monitors.filter((m) => m.name !== primary.name)]
            : monitors;
          const saved = surface === 'widget' ? await w.outerPosition() : readPosition();
          const target =
            ordered.find(
              (m) =>
                saved &&
                saved.x >= m.workArea.position.x &&
                saved.x < m.workArea.position.x + m.workArea.size.width &&
                saved.y >= m.workArea.position.y &&
                saved.y < m.workArea.position.y + m.workArea.size.height,
            ) ?? ordered[0];
          const height = Math.min(
            settings.widgetSize === 'compact' ? 420 : 560,
            target ? target.workArea.size.height / target.scaleFactor - 32 : 560,
          );
          const width = settings.widgetSize === 'compact' ? 310 : 380;
          if (target) {
            const initial = safePosition(
              saved,
              {
                width: Math.round(width * target.scaleFactor),
                height: Math.round(Math.max(220, height) * target.scaleFactor),
              },
              ordered.map((m) => ({
                ...m.workArea.position,
                width: m.workArea.size.width,
                height: m.workArea.size.height,
              })),
            );
            await w.setPosition(new PhysicalPosition(initial.x, initial.y));
            await w.setSize(
              new PhysicalSize(
                Math.round(width * target.scaleFactor),
                Math.round(Math.max(220, height) * target.scaleFactor),
              ),
            );
          } else await w.setSize(new LogicalSize(width, Math.max(220, height)));
          const size = await w.outerSize();
          const pos = safePosition(
            saved,
            { width: size.width, height: size.height },
            ordered.map((m) => ({
              ...m.workArea.position,
              width: m.workArea.size.width,
              height: m.workArea.size.height,
            })),
          );
          await w.setPosition(new PhysicalPosition(pos.x, pos.y));
          writePosition(pos);
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
        if (surface === 'widget' && !switching) {
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
