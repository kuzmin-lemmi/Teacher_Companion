import { isTauri } from '@tauri-apps/api/core';
import { COLOR_PRESETS, dayOf, isoDate, lessonColor, type AppData } from './domain';
import { isMobile } from './desktop';
import { hasPlus } from './plus';
/**
 * Телефон: расписание в шторке, напоминания и виджеты (плагин src-tauri/plugins/lessons).
 * Плагин не считает расписание сам — получает готовый план на несколько недель, поэтому
 * каникулы, сокращённые дни и заметки учитываются так же, как в приложении.
 */
/** Как звучит уведомление: мягкий перезвон, только вибрация или беззвучно. */
export type PhoneSound = 'chime' | 'vibrate' | 'silent';
export type PhoneSettings = {
  /** Текущий или следующий урок в шторке и на экране блокировки. */
  ongoing: boolean;
  /** За сколько минут напомнить об уроке; 0 — не напоминать. */
  remind: number;
  remindSound: PhoneSound;
  /** За сколько минут до конца урока напомнить про итоги и ДЗ; 0 — не напоминать. */
  ending: number;
  endingSound: PhoneSound;
  endingText: string;
  morning: boolean;
  morningTime: string;
  morningSound: PhoneSound;
  /** Вечером — сводка на завтра. */
  evening: boolean;
  eveningTime: string;
  eveningSound: PhoneSound;
  /** Во время урока перезвон заменяется вибрацией. */
  quiet: boolean;
};
export type PhonePreview = 'remind' | 'ending' | 'morning' | 'evening';
export const ENDING_TEXT = 'Пора подводить итоги и задавать ДЗ';
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
  remindSound: 'chime',
  // На уроке звук ни к чему — только вибрация.
  ending: 5,
  endingSound: 'vibrate',
  endingText: ENDING_TEXT,
  morning: false,
  morningTime: '07:30',
  morningSound: 'chime',
  evening: false,
  eveningTime: '19:00',
  eveningSound: 'chime',
  quiet: true,
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
/**
 * Какие уведомления на самом деле работают. Бесплатно — урок в шторке и утренняя сводка
 * со стандартным звуком; остальное — в «Плюсе». Сохранённые настройки не меняются:
 * с «Плюсом» включатся такими, как их настроили.
 */
export function effectivePhoneSettings(settings: PhoneSettings): PhoneSettings {
  if (hasPlus()) return settings;
  return { ...settings, remind: 0, ending: 0, evening: false, morningSound: 'chime', quiet: false };
}
export function buildPlan(data: AppData, saved: PhoneSettings, from = new Date()) {
  const settings = effectivePhoneSettings(saved);
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
/** Пример уведомления выбранного вида и звука — прямо в шторке. */
export async function previewSound(kind: PhonePreview, sound: PhoneSound) {
  if (phone()) await call('preview', { kind, sound });
}
/**
 * Откуда установлено приложение: из RuStore или файлом APK (с GitHub). От этого зависит,
 * где искать новые версии, — RuStore не разрешает ссылки на скачивание в обход магазина.
 */
export type InstallSource = 'rustore' | 'file';
export async function installSource(): Promise<InstallSource> {
  if (!phone()) return 'file';
  const { installer } = await call<{ installer: string }>('installer');
  return installer === 'ru.vk.store' ? 'rustore' : 'file';
}
/** Программа для Windows: ссылку отправляют себе с телефона и открывают на компьютере. */
export const DESKTOP_URL =
  'https://github.com/kuzmin-lemmi/Teacher_Companion/releases/latest/download/TeacherCompanion-Setup.exe';
/**
 * Системное «Поделиться»: в мессенджер, почту, «Избранное». Где его нет (браузер на компьютере) —
 * текст копируется. `false` — пользователь закрыл окно, ничего не отправив.
 */
export async function shareText(text: string, title: string): Promise<'shared' | 'copied' | false> {
  if (phone()) {
    await call('share', { text, title });
    return 'shared';
  }
  if (navigator.share)
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
    }
  await navigator.clipboard.writeText(text);
  return 'copied';
}
/** Предложить лаунчеру поставить виджет. `false` — лаунчер так не умеет. */
export async function pinWidget(kind: 'now' | 'day'): Promise<boolean> {
  if (!phone()) return false;
  return (await call<{ ok: boolean }>('pin', { kind })).ok;
}
