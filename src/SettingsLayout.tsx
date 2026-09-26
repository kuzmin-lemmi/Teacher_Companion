import type { ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { App as ScheduleEditor } from './App';
import { Backups } from './Backups';
import type { AppData } from './domain';
import type { Storage } from './storage';
import { appVersion } from './version';
export type SettingsPage = 'schedule' | 'preferences' | 'backups' | 'about';
const sections = [
  ['schedule', 'Расписание и звонки'],
  ['preferences', 'Внешний вид и окно'],
  ['backups', 'Резервные копии'],
  ['about', 'О программе'],
] as const;
const titles: Record<Exclude<SettingsPage, 'schedule'>, string> = {
  preferences: 'Настройки приложения',
  backups: 'Ваши данные',
  about: 'О программе',
};
export function SettingsLayout({
  page,
  data,
  editorStorage,
  preferences,
  onDirty,
  onNavigate,
  onRestore,
  onOpenWizard,
  updatePanel,
  updateVersion,
}: {
  page: SettingsPage;
  data: AppData;
  editorStorage: Storage;
  preferences: ReactNode;
  onDirty: (dirty: boolean) => void;
  onNavigate: (page: SettingsPage | 'widget') => void;
  onRestore: (data: AppData) => Promise<void>;
  onOpenWizard: () => void;
  updatePanel: ReactNode;
  /** Новая версия, о которой стоит ненавязчиво напомнить. */
  updateVersion: string | null;
}) {
  return (
    <div className="settings-root">
      <div className="settings-toolbar">
        <button onClick={() => onNavigate('widget')}>← К виджету</button>
        <nav aria-label="Разделы приложения">
          {sections.map(([id, label]) => (
            <button
              key={id}
              aria-current={page === id ? 'page' : undefined}
              onClick={() => onNavigate(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {updateVersion && page !== 'about' && (
          <button className="update-pill" onClick={() => onNavigate('about')}>
            Доступна версия {updateVersion}
          </button>
        )}
      </div>
      {page === 'schedule' ? (
        <ScheduleEditor storage={editorStorage} onDirty={onDirty} />
      ) : (
        <main className="settings-content">
          <p className="eyebrow">ПОМОЩНИК УЧИТЕЛЯ</p>
          <h1>{titles[page]}</h1>
          {page === 'preferences' ? (
            preferences
          ) : page === 'backups' ? (
            <Backups data={data} onRestore={onRestore} storage={editorStorage} />
          ) : (
            <>
              {updatePanel}
              <About onOpenWizard={onOpenWizard} />
            </>
          )}
        </main>
      )}
    </div>
  );
}
function About({ onOpenWizard }: { onOpenWizard: () => void }) {
  return (
    <section className="panel about">
      <span className="brand-icon">У</span>
      <h2>Teacher Companion</h2>
      <p>Версия {appVersion} · Помощник учителя</p>
      <p className="muted">
        Небольшое расписание для повседневной работы. Все данные хранятся локально. Приложение не
        отправляет расписание на сервер и не требует аккаунта. В сеть оно обращается только для
        проверки обновлений на GitHub — это можно выключить в настройках.
      </p>
      <p className="hint">
        {isTauri()
          ? 'Windows-приложение · SQLite'
          : 'Браузерный предпросмотр · данные этого браузера'}
      </p>
      <p>Устанавливается в профиль пользователя, права администратора не нужны.</p>
      <button onClick={onOpenWizard}>Открыть мастер настройки</button>
    </section>
  );
}
