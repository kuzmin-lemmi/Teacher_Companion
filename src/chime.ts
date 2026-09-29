/**
 * Звуковые и системные уведомления для учителя перед окончанием урока.
 * Звук синтезируется через Web Audio API (мягкий двухтональный перезвон),
 * не требует внешних mp3-файлов и звучит тихо и ненавязчиво.
 */

import { isTauri } from '@tauri-apps/api/core';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Проигрывает мягкий, ненавязчивый двухтональный перезвон (ноты До и Ми второй октавы).
 */
export function playChime(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Первая нота: C5 (~523 Гц)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(523.25, now);

  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(0.08, now + 0.03);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.4);

  // Вторая нота: E5 (~659 Гц)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(659.25, now + 0.15);

  gain2.gain.setValueAtTime(0, now + 0.15);
  gain2.gain.linearRampToValueAtTime(0.1, now + 0.18);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.15);
  osc2.stop(now + 0.65);
}

/**
 * Запрашивает разрешение на системные всплывающие уведомления.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!canShowSystemNotification()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

/**
 * Системные уведомления через браузерный `Notification` работают только в обычном браузере:
 * в окне Tauri (WebView2 / Android) они не показываются, там остаются звук и плашка в виджете.
 */
export const canShowSystemNotification = (): boolean =>
  typeof window !== 'undefined' && 'Notification' in window && !isTauri();

/**
 * Проверяет, включены ли системные уведомления.
 */
export function isNotificationGranted(): boolean {
  return canShowSystemNotification() && Notification.permission === 'granted';
}

/**
 * Показывает системное уведомление на Windows / рабочем столе.
 */
export function showSystemNotification(title: string, body: string): void {
  if (!isNotificationGranted()) return;

  try {
    const n = new Notification(title, {
      body,
      silent: true, // звук воспроизводится отдельно через наш мягкий перезвон
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Безопасный перехват в средах, где Notification запрещён
  }
}
