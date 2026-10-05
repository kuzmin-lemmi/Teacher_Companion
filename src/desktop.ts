import { isTauri, invoke } from '@tauri-apps/api/core';
import type { Settings } from './domain';
import { fitSize, safePosition, type Point } from './geometry';
export type Surface = 'widget' | 'settings';
/** Телефон — и приложение на Android, и браузер телефона. Окна-виджета, трея и автозапуска там нет. */
export const isMobile = () => /Android|iPhone|iPad/i.test(navigator.userAgent);
/** Приложение на компьютере: окно-виджет, трей, автозапуск, обновления через установщик. */
export const isDesktop = () => isTauri() && !isMobile();
let surface: Surface = 'settings';
let switching = false;
let lastPlaced: Point | null = null;
let queue = Promise.resolve();
const positionKey = 'teacher-companion-widget-position-v2';
const settingsSizeKey = 'teacher-companion-settings-size-v1';
/** Что уже применено к окну: повторная настройка с тем же результатом окно не трогает. */
let applied = '';
/** Сменился экран (проектор, масштаб): окно настраивается заново. */
let displayEpoch = 0;
export function invalidateWindow() {
  displayEpoch++;
}
function readSettingsSize(): { width: number; height: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(settingsSizeKey) ?? 'null');
    return s && s.width >= 400 && s.height >= 300 ? s : null;
  } catch {
    return null;
  }
}
function writeSettingsSize(size: { width: number; height: number }) {
  try {
    localStorage.setItem(settingsSizeKey, JSON.stringify(size));
  } catch {
    // Размер просто не запомнится.
  }
}
/** Подпись подключённых экранов: по ней видно, что подключили проектор или сменили разрешение. */
export async function displaySignature(): Promise<string> {
  if (!isDesktop()) return '';
  const { availableMonitors } = await import('@tauri-apps/api/window');
  const monitors = await availableMonitors();
  return monitors
    .map((m) => [m.position.x, m.position.y, m.size.width, m.size.height, m.scaleFactor].join(','))
    .join('|');
}
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
  if (!isDesktop()) return;
  const api = await import('@tauri-apps/plugin-autostart');
  if ((await api.isEnabled()) !== enabled) await (enabled ? api.enable() : api.disable());
}
export async function showWindow() {
  if (isDesktop()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    await w.unminimize();
    await w.show();
    await w.setFocus();
  }
}
export async function hideWindow() {
  if (isDesktop()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().hide();
  }
}
export async function exitApp() {
  if (isDesktop()) {
    await invoke('quit_app');
  }
}
export async function startDrag(locked: boolean) {
  if (!locked && isDesktop()) {
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
  if (!isDesktop()) return Promise.resolve();
  const operation = queue
    .catch(() => {})
    .then(async () => {
      const {
        getCurrentWindow,
        LogicalSize,
        PhysicalSize,
        PhysicalPosition,
        availableMonitors,
        currentMonitor,
        primaryMonitor,
      } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      const key = JSON.stringify([
        next,
        next === 'widget' && settings.alwaysOnTop,
        next === 'widget' && settings.widgetSize,
        next === 'widget' && settings.widgetCorner,
        next === 'widget' && contentHeight,
        displayEpoch,
      ]);
      // Повторный вызов с теми же параметрами (фокус, сворачивание, сохранение настроек)
      // ничего не меняет: иначе окно дёргалось бы при каждом возвращении в него.
      if (key === applied && surface === next) return;
      switching = true;
      try {
        const changed = surface !== next;
        await w.setMinSize(
          new LogicalSize(next === 'widget' ? 200 : 640, next === 'widget' ? 100 : 480),
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
          const monitor = (await currentMonitor()) ?? (await primaryMonitor());
          if (monitor) {
            const size = fitSize(
              readSettingsSize() ?? { width: 1180, height: 800 },
              monitor.workArea.size,
              monitor.scaleFactor,
            );
            await w.setSize(new LogicalSize(size.width, size.height));
          } else await w.setSize(new LogicalSize(1180, 800));
          await w.center();
        }
        surface = next;
        applied = key;
        await w.show();
      } finally {
        switching = false;
      }
    });
  queue = operation;
  return operation;
}
/**
 * Окно настроек больше экрана или частично за его краем (включили проектор с меньшим
 * разрешением) — уменьшает и возвращает его на экран.
 */
export function fitWindow(): Promise<void> {
  if (!isDesktop() || surface !== 'settings') return Promise.resolve();
  const operation = queue
    .catch(() => {})
    .then(async () => {
      if (surface !== 'settings' || switching) return;
      const { getCurrentWindow, currentMonitor, PhysicalSize, PhysicalPosition } =
        await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      if ((await w.isMinimized()) || (await w.isMaximized())) return;
      const monitor = await currentMonitor();
      if (!monitor) return;
      const area = monitor.workArea;
      const outer = await w.outerSize();
      const at = await w.outerPosition();
      const tooBig = outer.width > area.size.width || outer.height > area.size.height;
      const outside =
        at.x < area.position.x ||
        at.y < area.position.y ||
        at.x + outer.width > area.position.x + area.size.width ||
        at.y + outer.height > area.position.y + area.size.height;
      if (!tooBig && !outside) return;
      switching = true;
      try {
        let width = outer.width;
        let height = outer.height;
        if (tooBig) {
          const scale = monitor.scaleFactor;
          const size = fitSize(
            { width: outer.width / scale, height: outer.height / scale },
            area.size,
            scale,
          );
          width = Math.round(size.width * scale);
          height = Math.round(size.height * scale);
          await w.setSize(new PhysicalSize(width, height));
        }
        const pos = safePosition(at, { width, height }, [
          { ...area.position, width: area.size.width, height: area.size.height },
        ]);
        await w.setPosition(new PhysicalPosition(pos.x, pos.y));
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
  if (!isDesktop()) return () => {};
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
    // Размер окна настроек запоминается, чтобы в следующий раз оно открылось таким же.
    let resizing: ReturnType<typeof setTimeout> | undefined;
    cleanups.push(
      await w.onResized((e) => {
        clearTimeout(resizing);
        if (surface !== 'settings' || switching) return;
        resizing = setTimeout(async () => {
          if (surface !== 'settings' || switching) return;
          if ((await w.isMinimized()) || (await w.isMaximized())) return;
          const scale = await w.scaleFactor();
          const width = Math.round(e.payload.width / scale);
          const height = Math.round(e.payload.height / scale);
          if (width >= 400 && height >= 300) writeSettingsSize({ width, height });
        }, 500);
      }),
    );
    cleanups.push(() => clearTimeout(resizing));
    return () => cleanups.forEach((fn) => fn());
  } catch (error) {
    cleanups.forEach((fn) => fn());
    throw error;
  }
}
