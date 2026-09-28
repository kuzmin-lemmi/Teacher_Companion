import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { isMobile } from './desktop';
/**
 * Системная кнопка «Назад» на Android. Срабатывает только верхний обработчик:
 * открыта камера поверх настроек — «Назад» закрывает камеру, а не настройки.
 * Когда обработчиков нет, Android ведёт себя как обычно и сворачивает приложение.
 */
const stack: (() => void)[] = [];
let listener: Promise<{ unregister(): Promise<void> } | null> | null = null;
function sync() {
  if (stack.length && !listener)
    listener = import('@tauri-apps/api/app')
      .then((app) => app.onBackButtonPress(() => stack.at(-1)?.()))
      .catch(() => null);
  else if (!stack.length && listener) {
    const current = listener;
    listener = null;
    void current.then((l) => l?.unregister()).catch(() => {});
  }
}
export function useBackButton(active: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!active || !isTauri() || !isMobile()) return;
    const handler = () => latest.current();
    stack.push(handler);
    sync();
    return () => {
      const i = stack.lastIndexOf(handler);
      if (i >= 0) stack.splice(i, 1);
      sync();
    };
  }, [active]);
}
