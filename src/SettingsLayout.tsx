import type { ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { App as ScheduleEditor, type Tab } from './App';
import { Backups } from './Backups';
import { Icon, type IconName } from './icons';
import type { AppData } from './domain';
import type { Storage } from './storage';
import { appVersion } from './version';
export type SettingsPage = Tab | 'preferences' | 'backups' | 'about';
const editorPages: SettingsPage[] = ['schedule', 'bells', 'calendar'];
/** Разделы меню; пустая строка — разделитель групп. */
const sections: ([SettingsPage, IconName, string] | null)[] = [
  ['schedule', 'table', 'Расписание'],
  ['bells', 'bell', 'Звонки'],
  ['calendar', 'beach', 'Каникулы'],
  null,
  ['preferences', 'palette', 'Внешний вид'],
  ['backups', 'database', 'Копии'],
  ['about', 'info', 'О программе'],
];
const titles: Record<Exclude<SettingsPage, Tab>, string> = {
  preferences: 'Настройки приложения',
  backups: 'Ваши данные',
  about: 'О программе',
};
/** Настройки на компьютере и в браузерном предпросмотре; на телефоне — MobileSettings. */
export function SettingsLayout({
  page,
  data,
  editorStorage,
  preferences,
  onDirty,
  onNavigate,
  onRestore,
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
  updatePanel: ReactNode;
  /** Новая версия, о которой стоит ненавязчиво напомнить. */
  updateVersion: string | null;
}) {
  return (
    <div className="settings-root">
      <nav className="rail" aria-label="Разделы приложения">
        <button className="rail-back" onClick={() => onNavigate('widget')} title="К виджету">
          <Icon name="back" />
          <span className="rail-label">К виджету</span>
        </button>
        <div className="rail-sep" />
        {sections.map((section, i) =>
          section ? (
            <button
              key={section[0]}
              className="rail-item"
              title={section[2]}
              aria-current={page === section[0] ? 'page' : undefined}
              onClick={() => onNavigate(section[0])}
            >
              <Icon name={section[1]} />
              <span className="rail-label">{section[2]}</span>
            </button>
          ) : (
            <div className="rail-sep" key={i} />
          ),
        )}
        <span className="rail-spacer" />
        {updateVersion && page !== 'about' && (
          <button
            className="update-pill"
            title={`Доступна версия ${updateVersion}`}
            onClick={() => onNavigate('about')}
          >
            Доступна версия {updateVersion}
          </button>
        )}
        <small className="rail-version">v{appVersion}</small>
      </nav>
      {/* Один и тот же редактор на трёх страницах: переключение не сбрасывает его правки. */}
      {editorPages.includes(page) ? (
        <ScheduleEditor storage={editorStorage} onDirty={onDirty} tab={page as Tab} />
      ) : (
        <main className="settings-content">
          <h1>{titles[page as Exclude<SettingsPage, Tab>]}</h1>
          {page === 'preferences' ? (
            preferences
          ) : page === 'backups' ? (
            <Backups data={data} onRestore={onRestore} storage={editorStorage} />
          ) : (
            <>
              {updatePanel}
              <About />
            </>
          )}
        </main>
      )}
    </div>
  );
}
function About() {
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
    </section>
  );
}
