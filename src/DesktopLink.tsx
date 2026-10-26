import { useState } from 'react';
import { DESKTOP_URL, shareText } from './phone';
/**
 * Телефон: отправить себе ссылку на программу для Windows — в мессенджер или почту —
 * и открыть её уже на компьютере. Скачивать программу на телефон незачем.
 */
export function SendDesktopLink({ className = 'secondary' }: { className?: string }) {
  const [status, setStatus] = useState('');
  async function send() {
    setStatus('');
    try {
      const result = await shareText(
        `«Расписание учителя» для Windows — расписание на рабочем столе компьютера. Скачать: ${DESKTOP_URL}`,
        'Расписание учителя для компьютера',
      );
      if (result === 'copied')
        setStatus('Ссылка скопирована — отправьте её себе в мессенджер или на почту.');
    } catch {
      setStatus(`Не получилось открыть «Поделиться». Адрес программы: ${DESKTOP_URL}`);
    }
  }
  return (
    <>
      <button type="button" className={className} onClick={() => void send()}>
        Отправить ссылку на компьютер
      </button>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
    </>
  );
}
