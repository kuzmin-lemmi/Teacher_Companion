import { useEffect, useRef, useState } from 'react';
import type { AppData, Countdown, Day } from './domain';
import { playChime, showSystemNotification } from './chime';

/**
 * Отслеживает окончание урока и подаёт звуковой сигнал и/или системное уведомление
 * за заданное число минут до звонка («Пора подводить итоги и задавать ДЗ»).
 */
export function useBellAlert(
  data: AppData,
  day: Day | null,
  timer: Countdown | null,
  dateKey: string,
) {
  const alerted = useRef<Set<string>>(new Set());
  const [activeAlert, setActiveAlert] = useState<{
    lessonNumber: number;
    className: string;
    minutes: number;
    message: string;
  } | null>(null);

  const {
    bellAlertMinutes = 5,
    bellAlertSound = true,
    bellAlertPopup = true,
    bellAlertMessage = 'Пора подводить итоги и задавать ДЗ',
  } = data.settings;

  // `timer` и `day` пересоздаются при каждом рендере — зависим от примитивов, иначе setState зациклит рендер.
  const lessonId = timer?.kind === 'lesson' ? timer.lessonId : null;
  const minutesLeft = timer?.kind === 'lesson' ? timer.minutes : 0;
  const hasDay = !!day;

  useEffect(() => {
    if (!bellAlertMinutes || !day || lessonId === null) {
      setActiveAlert(null);
      return;
    }

    const lesson = day.lessons.find((l) => l.id === lessonId);
    if (!lesson) return;

    const alertKey = `${dateKey}:${lesson.id}`;

    if (minutesLeft <= bellAlertMinutes && minutesLeft > 0) {
      const next = {
        lessonNumber: lesson.lessonNumber,
        className: lesson.className,
        minutes: minutesLeft,
        message: bellAlertMessage,
      };
      setActiveAlert((prev) =>
        prev &&
        prev.lessonNumber === next.lessonNumber &&
        prev.minutes === next.minutes &&
        prev.className === next.className &&
        prev.message === next.message
          ? prev
          : next,
      );

      if (!alerted.current.has(alertKey)) {
        alerted.current.add(alertKey);

        if (bellAlertSound) {
          playChime();
        }

        if (bellAlertPopup) {
          const time = day.time(lesson);
          const endStr = time ? ` (до ${time.end})` : '';
          showSystemNotification(
            `Помощник учителя · ${lesson.className}`,
            `Урок ${lesson.lessonNumber}${endStr}: осталось ${minutesLeft} мин. ${bellAlertMessage}`,
          );
        }
      }
    } else {
      setActiveAlert(null);
    }
  }, [
    hasDay,
    lessonId,
    minutesLeft,
    dateKey,
    bellAlertMinutes,
    bellAlertSound,
    bellAlertPopup,
    bellAlertMessage,
  ]);

  return { activeAlert, dismissAlert: () => setActiveAlert(null) };
}
