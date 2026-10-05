import { isTauri } from '@tauri-apps/api/core';
import { COLOR_PRESETS, dayOf, isoDate, lessonColor, type AppData } from './domain';
import { isMobile } from './desktop';
/**
 * Телефон: расписание в шторке, напоминания и виджеты (плагин src-tauri/plugins/lessons).
 * Плагин не считает расписание сам — получает готовый план на несколько недель, поэтому
 * каникулы, сокращённые дни и заметки учитываются так же, как в приложении.
 */
export type PhoneSettings = {
  /** Текущий или следующий урок в шторке и на экране блокировки. */
  ongoing: boolean;
  /** За сколько минут напомнить об уроке; 0 — не напоминать. */
  remind: number;
  morning: boolean;
  morningTime: string;
};
export type PhoneStatus = {
  notifications: boolean;
  exact: boolean;
  battery: boolean;
  widgets: number;
  pin: boolean;
};
export const PLAN_DAYS = 42;
const KEY = 'teacher-companion-phone-v1';
export const defaultPhoneSettings: PhoneSettings = {
  ongoing: true,
  remind: 5,
  morning: false,
  morningTime: '07:30',
};
export function loadPhoneSettings(): PhoneSettings {
  try {
    return { ...defaultPhoneSettings, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaultPhoneSettings;
  }
}
export function savePhoneSettings(value: PhoneSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Без хранилища настройка действует до перезапуска.
  }
}
function offLabel(title: string, end: string, start: string) {
  const name = title.trim() || 'Выходной';
  if (start === end) return name;
  const [y, m, d] = end.split('-').map(Number);
  const date = new Date(y, m - 1, d).toLocaleDateString('ru', { day: 'numeric', month: 'long' });
  return `${name} · до ${date}`;
}
/** Готовые дни с сегодняшнего: уроки со временем, каникулы, сокращённые дни, заметки. */
export function buildPlan(data: AppData, settings: PhoneSettings, from = new Date()) {
  const days = [];
  for (let i = 0; i < PLAN_DAYS; i++) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const day = dayOf(data, date);
    days.push({
      date: isoDate(date),
      off: day.off ? offLabel(day.off.title, day.off.end, day.off.start) : '',
      short: day.short,
      lessons: day.lessons.flatMap((lesson) => {
        const time = day.time(lesson);
        if (!time) return [];
        return [
          {
            number: lesson.lessonNumber,
            className: lesson.className.trim(),
            subject: lesson.subject.trim(),
            room: lesson.room.trim(),
            start: time.start,
            end: time.end,
            note: day.note(lesson.lessonNumber),
            // Цвет полоски урока в виджете: как в приложении, «#rrggbb» или пусто.
            color:
              COLOR_PRESETS.find((p) => p.id === lessonColor(lesson, data.settings))?.dot ?? '',
          },
        ];
      }),
    });
  }
  return { version: 1, settings, days };
}
const phone = () => isTauri() && isMobile();
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(`plugin:lessons|${command}`, args);
}
export async function syncPhone(data: AppData, settings = loadPhoneSettings()) {
  if (!phone()) return;
  await call('sync', { payload: JSON.stringify(buildPlan(data, settings)) });
}
export async function phoneStatus(): Promise<PhoneStatus | null> {
  if (!phone()) return null;
  return call<PhoneStatus>('status');
}
export async function allowNotifications() {
  if (phone()) await call('notifications');
}
export async function allowBackground() {
  if (phone()) await call('battery');
}
/** Предложить лаунчеру поставить виджет. `false` — лаунчер так не умеет. */
export async function pinWidget(kind: 'now' | 'day'): Promise<boolean> {
  if (!phone()) return false;
  return (await call<{ ok: boolean }>('pin', { kind })).ok;
}
