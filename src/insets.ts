/**
 * Отступы под строку состояния, кнопки навигации и клавиатуру Android.
 * MainActivity (scripts/android-patch.mjs) сообщает их сама — env(safe-area-inset-*)
 * в WebView часто равен нулю. Значения попадают в CSS-переменные --inset-*;
 * без них стили берут env(), а в браузере — ноль.
 */
type Insets = { top: number; right: number; bottom: number; left: number; keyboard: number };
declare global {
  interface Window {
    AndroidInsets?: { get(): string };
  }
}
function apply(value: Insets) {
  const style = document.documentElement.style;
  for (const side of ['top', 'right', 'bottom', 'left', 'keyboard'] as const)
    style.setProperty(`--inset-${side}`, `${Math.max(0, value[side] || 0)}px`);
}
export function watchInsets() {
  try {
    const raw = window.AndroidInsets?.get();
    if (raw) apply(JSON.parse(raw));
  } catch {
    // Нет моста — остаются значения из env().
  }
  window.addEventListener('androidinsets', (e) => apply((e as CustomEvent<Insets>).detail));
}
