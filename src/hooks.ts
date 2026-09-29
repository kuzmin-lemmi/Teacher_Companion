import { useEffect, useState } from 'react';
import { millisecondsUntilMidnight } from './calendar';
import type { AccentColor, Settings } from './domain';
export function useToday() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const date = new Date();
      setNow(date);
      timer = setTimeout(refresh, millisecondsUntilMidnight(date));
    }
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return now;
}
export function useTheme(theme: Settings['theme'], accentColor: AccentColor = 'emerald') {
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    function update() {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media?.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.accent = accentColor || 'emerald';
    }
    update();
    media?.addEventListener('change', update);
    return () => media?.removeEventListener('change', update);
  }, [theme, accentColor]);
}
/** Тикает ровно на смене минуты — иначе отсчёт «ещё N мин» отставал бы от звонка. */
export function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function refresh() {
      clearTimeout(timer);
      const date = new Date();
      setNow(date);
      timer = setTimeout(refresh, 60_050 - (date.getTime() % 60_000));
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  return now;
}
