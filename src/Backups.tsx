import { useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { exportBackup, importDesktopBackup, parseBackup } from './backup';
import { lessonCount } from './calendar';
import type { AppData } from './domain';
export function Backups({
  data,
  onRestore,
}: {
  data: AppData | null;
  onRestore: (data: AppData) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [candidate, setCandidate] = useState<AppData | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(fn: () => Promise<void>) {
    setStatus('');
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось выполнить операцию с файлом.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel backups">
      <p className="eyebrow">РЕЗЕРВНЫЕ КОПИИ</p>
      <h2>Расписание в надёжном месте</h2>
      <p className="muted">
        Сохраните уроки, звонки и настройки в один JSON-файл. Его можно восстановить на этом или
        другом компьютере.
      </p>
      <div className="backup-actions">
        <button
          disabled={!data || busy}
          onClick={() =>
            action(async () => {
              if (await exportBackup(data!)) setStatus('Резервная копия сохранена');
            })
          }
        >
          Экспортировать копию
        </button>
        <button
          disabled={busy}
          onClick={() => {
            if (isTauri())
              void action(async () => {
                setCandidate(await importDesktopBackup());
              });
            else input.current?.click();
          }}
        >
          Выбрать файл для восстановления
        </button>
      </div>
      <input
        ref={input}
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        accept=".json,application/json"
        aria-label="Файл резервной копии"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            void action(async () => {
              if (file.size > 1_000_000) throw new Error('Файл слишком большой. Максимум — 1 МБ.');
              setCandidate(parseBackup(await file.text()));
            });
        }}
      />
      {candidate && (
        <div className="restore-preview">
          <h3>Копия готова к восстановлению</h3>
          <p>
            {lessonCount(candidate.lessons.length)} за неделю · звонков: {candidate.bells.length}
          </p>
          <p className="muted">
            Текущие уроки, звонки и настройки будут заменены. Автозапуск сохранит текущее значение
            этого компьютера.
          </p>
          <div className="backup-actions">
            <button disabled={busy} onClick={() => setCandidate(null)}>
              Отмена
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  await onRestore({
                    ...candidate,
                    onboardingComplete: true,
                    settings: {
                      ...candidate.settings,
                      launchOnStartup: data?.settings.launchOnStartup ?? false,
                    },
                  });
                  setCandidate(null);
                  setStatus('Расписание восстановлено');
                })
              }
            >
              Восстановить эту копию
            </button>
          </div>
        </div>
      )}
      <p role="status" className="hint">
        {status}
      </p>
    </section>
  );
}
