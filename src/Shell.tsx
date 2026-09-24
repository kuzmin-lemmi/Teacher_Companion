import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { App as ScheduleEditor } from './App';
import { Backups } from './Backups';
import { Preferences } from './Preferences';
import { Widget } from './Widget';
import { emptyData, type AppData, type Settings } from './domain';
import { getStorage, type Storage } from './storage';
import {
  configureWindow,
  exitApp,
  hideWindow,
  resetPosition,
  showWindow,
  startDrag,
  subscribeDesktop,
  syncAutostart,
} from './desktop';
import { useTheme } from './hooks';
type Page = 'widget' | 'schedule' | 'preferences' | 'backups' | 'about';
const steps = ['Добро пожаловать', 'Звонки', 'Расписание', 'Внешний вид', 'Готово'];
export function Shell({ storage: suppliedStorage }: { storage?: Storage }) {
  const [data, setData] = useState<AppData | null>(null);
  const [page, setPage] = useState<Page>('widget');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nativeError, setNativeError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'today' | 'next'>('next');
  const [hidden, setHidden] = useState(false);
  const [preview, setPreview] = useState<Settings | null>(null);
  const [revision, setRevision] = useState(0);
  const [confirmation, setConfirmation] = useState<{ message: string; action: () => void } | null>(
    null,
  );
  const dataRef = useRef(data);
  dataRef.current = data;
  const saving = useRef(false);
  useTheme(preview?.theme ?? data?.settings.theme ?? 'dark');
  const persist = useCallback(
    async (next: AppData) => {
      if (saving.current) throw new Error('Сохранение уже выполняется.');
      saving.current = true;
      setBusy(true);
      const previous = dataRef.current;
      try {
        await syncAutostart(next.settings.launchOnStartup);
        try {
          await (suppliedStorage ?? (await getStorage())).save(next);
        } catch (e) {
          try {
            await syncAutostart(previous?.settings.launchOnStartup ?? false);
          } catch {
            setNativeError(
              'Не удалось восстановить автозапуск после ошибки сохранения. Проверьте настройку в Windows.',
            );
          }
          throw e;
        }
        dataRef.current = next;
        setData(next);
        setError('');
      } catch {
        throw new Error(
          'Не удалось сохранить данные или применить автозапуск. Изменения остались на экране.',
        );
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [suppliedStorage],
  );
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const value = await (suppliedStorage ?? (await getStorage())).load();
        if (!cancelled) {
          dataRef.current = value;
          setData(value);
          setError('');
          setStep((value.onboardingComplete ?? value.lessons.length > 0) ? null : 0);
        }
      } catch {
        if (!cancelled)
          setError(
            'Не удалось загрузить расписание. Исходные данные не изменены. Повторите попытку или восстановите резервную копию.',
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppliedStorage, attempt]);
  const editorStorage = useMemo<Storage>(
    () => ({ load: async () => dataRef.current ?? emptyData(), save: persist }),
    [persist],
  );
  const surface = page === 'widget' && step === null && !!data ? 'widget' : 'settings';
  const settings = data?.settings;
  useEffect(() => {
    document.documentElement.dataset.surface = surface;
    if (!settings) return;
    let cancelled = false;
    configureWindow(surface, settings).catch(() => {
      if (!cancelled)
        setNativeError(
          'Не удалось применить поведение окна. Настройки сохранены; попробуйте открыть виджет ещё раз.',
        );
    });
    return () => {
      cancelled = true;
    };
  }, [surface, settings, revision]);
  function guard(action: () => void) {
    if (busy) return;
    if (dirty)
      setConfirmation({
        message: 'Есть несохранённые изменения. Выйти без сохранения?',
        action: () => {
          setDirty(false);
          setPreview(null);
          action();
        },
      });
    else action();
  }
  function navigate(next: Page) {
    guard(() => {
      setHidden(false);
      setPage(next);
    });
  }
  async function close(forceExit = false) {
    if (busy) return;
    if (forceExit || dataRef.current?.settings.closeBehavior === 'exit')
      guard(() => {
        void exitApp().catch(() => setNativeError('Не удалось завершить приложение.'));
        if (!isTauri()) setHidden(true);
      });
    else {
      try {
        await hideWindow();
        if (!isTauri()) setHidden(true);
      } catch {
        setNativeError('Не удалось скрыть окно.');
      }
    }
  }
  const handlers = useRef({
    tray: (_action: string) => {},
    close: () => {},
    displayChanged: () => {},
  });
  handlers.current = {
    tray: (action) => {
      void showWindow().catch(() => setNativeError('Не удалось показать окно.'));
      if (action === 'quit') {
        void close(true);
        return;
      }
      if (action === 'settings') {
        navigate('schedule');
        return;
      }
      guard(() => {
        setPage('widget');
        setHidden(false);
        if (action === 'today' || action === 'next') setMode(action);
        setRevision((r) => r + 1);
      });
    },
    close: () => {
      void close();
    },
    displayChanged: () => setRevision((r) => r + 1),
  };
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    subscribeDesktop({
      tray: (a) => handlers.current.tray(a),
      close: () => handlers.current.close(),
      displayChanged: () => handlers.current.displayChanged(),
      movedError: () => setNativeError('Не удалось сохранить положение окна.'),
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => setNativeError('Не удалось подключить управление окном и треем.'));
    const focus = () => handlers.current.displayChanged();
    window.addEventListener('focus', focus);
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener('focus', focus);
    };
  }, []);
  useEffect(() => {
    const fn = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty, busy]);
  async function finish() {
    if (!data) return;
    try {
      await persist({ ...data, onboardingComplete: true });
      setStep(null);
      setPage('widget');
    } catch (e) {
      setNativeError((e as Error).message);
    }
  }
  const saveSettings = async (value: Settings) => {
    if (data) await persist({ ...data, settings: value });
  };
  const commonPreferences = data ? (
    <Preferences
      settings={data.settings}
      onSave={saveSettings}
      onDirty={setDirty}
      onPreview={setPreview}
      onResetPosition={() => {
        void resetPosition()
          .then(() => {
            setRevision((r) => r + 1);
            setNativeError('Позиция сброшена. Виджет появится справа сверху при открытии.');
          })
          .catch(() => setNativeError('Не удалось сбросить позицию.'));
      }}
      onboarding={step !== null}
    />
  ) : null;
  const restore = async (value: AppData) => {
    await persist(value);
    setStep(null);
    setPage('backups');
  };
  return (
    <>
      {loading ? (
        <div className="loading-screen" role="status">
          Загружаем ваше расписание…
        </div>
      ) : !data ? (
        <div className="recovery-screen">
          <h1>Расписание недоступно</h1>
          <p role="alert">{error}</p>
          <button onClick={() => setAttempt((a) => a + 1)}>Повторить загрузку</button>
          <Backups data={null} onRestore={restore} />
        </div>
      ) : hidden ? (
        <div className="preview-hidden">
          <span className="brand-icon">У</span>
          <h1>Виджет скрыт</h1>
          <p>В Windows его можно открыть через значок в системном трее.</p>
          <button className="primary" onClick={() => setHidden(false)}>
            Показать снова
          </button>
        </div>
      ) : step !== null ? (
        <div className="onboarding">
          <header className="onboarding-header">
            <span className="brand-icon">У</span>
            <div>
              <p className="eyebrow">ПЕРВЫЙ ЗАПУСК</p>
              <h1>Настроим ваш рабочий день</h1>
            </div>
            <span className="badge">Шаг {step + 1} из 5</span>
          </header>
          <ol className="steps">
            {steps.map((label, i) => (
              <li key={label} aria-current={step === i ? 'step' : undefined}>
                <span>{i + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          {step === 0 ? (
            <section className="welcome panel">
              <p className="eyebrow">МЕНЬШЕ ЗАБОТ О ЗАВТРАШНЕМ ДНЕ</p>
              <h2>
                Ваше расписание.
                <br />
                Всегда под рукой.
              </h2>
              <p>
                Один раз заполните неделю — помощник покажет ближайший день с занятиями. Без
                регистрации, интернета и лишних действий.
              </p>
              <div className="welcome-features">
                <span>01 · Настройте звонки</span>
                <span>02 · Добавьте классы</span>
                <span>03 · Выберите внешний вид</span>
              </div>
            </section>
          ) : step === 1 || step === 2 ? (
            <div className="embedded-editor">
              <ScheduleEditor
                key={step}
                initialTab={step === 1 ? 'bells' : 'schedule'}
                storage={editorStorage}
                onDirty={setDirty}
              />
            </div>
          ) : step === 3 ? (
            commonPreferences
          ) : (
            <section className="welcome panel">
              <p className="eyebrow">ВСЁ ГОТОВО</p>
              <h2>Завтра стало понятнее.</h2>
              <p>
                {data.lessons.length
                  ? 'Расписание сохранено. Откройте виджет и продолжайте работать как обычно.'
                  : 'Можно начать с пустого виджета и добавить уроки позднее в настройках.'}
              </p>
            </section>
          )}
          <footer className="onboarding-footer">
            <button disabled={step === 0 || busy} onClick={() => guard(() => setStep(step - 1))}>
              Назад
            </button>
            <span>
              {dirty
                ? 'Сохраните изменения перед продолжением.'
                : 'Все настройки можно изменить позже.'}
            </span>
            <button
              className="primary"
              disabled={dirty || busy}
              onClick={() => {
                if (step === 4) void finish();
                else setStep(step + 1);
              }}
            >
              {step === 4 ? 'Открыть виджет' : 'Продолжить'}
            </button>
          </footer>
        </div>
      ) : page === 'widget' ? (
        <div className={`widget-stage ${isTauri() ? 'native' : 'browser'}`}>
          <Widget
            data={data}
            mode={mode}
            onMode={setMode}
            onSettings={() => navigate('schedule')}
            onClose={() => void close()}
            onLock={() => {
              if (!busy)
                void persist({
                  ...data,
                  settings: { ...data.settings, locked: !data.settings.locked },
                }).catch((e) => setNativeError(e.message));
            }}
            onDrag={() =>
              void startDrag(data.settings.locked).catch(() =>
                setNativeError('Не удалось переместить окно.'),
              )
            }
          />
          {!isTauri() && (
            <p className="preview-caption">
              Предпросмотр виджета · функции окна доступны в Windows
            </p>
          )}
        </div>
      ) : (
        <div className="settings-root">
          <div className="settings-toolbar">
            <button onClick={() => navigate('widget')}>← К виджету</button>
            <nav aria-label="Разделы приложения">
              {(
                [
                  ['schedule', 'Расписание и звонки'],
                  ['preferences', 'Внешний вид и окно'],
                  ['backups', 'Резервные копии'],
                  ['about', 'О программе'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-current={page === id ? 'page' : undefined}
                  onClick={() => navigate(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
          {page === 'schedule' ? (
            <ScheduleEditor storage={editorStorage} onDirty={setDirty} />
          ) : (
            <main className="settings-content">
              <p className="eyebrow">ПОМОЩНИК УЧИТЕЛЯ</p>
              <h1>
                {page === 'preferences'
                  ? 'Настройки приложения'
                  : page === 'backups'
                    ? 'Ваши данные'
                    : 'О программе'}
              </h1>
              {page === 'preferences' ? (
                commonPreferences
              ) : page === 'backups' ? (
                <Backups data={data} onRestore={restore} />
              ) : (
                <section className="panel about">
                  <span className="brand-icon">У</span>
                  <h2>Teacher Companion</h2>
                  <p>Версия 0.1.0 · Помощник учителя</p>
                  <p className="muted">
                    Небольшое расписание для повседневной работы. Все данные хранятся локально.
                    Приложение не отправляет расписание на сервер и не требует аккаунта.
                  </p>
                  <p className="hint">
                    {isTauri()
                      ? 'Windows-приложение · SQLite'
                      : 'Браузерный предпросмотр · данные этого браузера'}
                  </p>
                  <p>Поставка: .exe без установщика.</p>
                  <button onClick={() => guard(() => setStep(0))}>Открыть мастер настройки</button>
                </section>
              )}
            </main>
          )}
        </div>
      )}
      {nativeError && (
        <div className="app-notice" role="status">
          <span>{nativeError}</span>
          <button aria-label="Закрыть сообщение" onClick={() => setNativeError('')}>
            ×
          </button>
        </div>
      )}
      {confirmation && (
        <div className="modal-backdrop">
          <section
            className="confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setConfirmation(null);
              if (event.key === 'Tab') {
                const buttons = event.currentTarget.querySelectorAll('button');
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <h2 id="confirm-title">Несохранённые изменения</h2>
            <p>{confirmation.message}</p>
            <div>
              <button autoFocus onClick={() => setConfirmation(null)}>
                Остаться
              </button>
              <button
                className="primary"
                onClick={() => {
                  const action = confirmation.action;
                  setConfirmation(null);
                  action();
                }}
              >
                Выйти без сохранения
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
