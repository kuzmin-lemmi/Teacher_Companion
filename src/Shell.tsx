import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Backups } from './Backups';
import { ConfirmDialog } from './ConfirmDialog';
import { Onboarding } from './Onboarding';
import { Preferences, cornerLabels } from './Preferences';
import { SettingsLayout, type SettingsPage } from './SettingsLayout';
import { Widget } from './Widget';
import { UpdatePanel, type UpdateState } from './UpdatePanel';
import {
  UPDATE_FIRST_CHECK,
  UPDATE_INTERVAL,
  dismissUpdate,
  dismissedVersion,
  findUpdate,
  type AvailableUpdate,
  type UpdateFinder,
} from './updates';
import { dateKey } from './calendar';
import { emptyData, type AppData, type DayMode, type Settings } from './domain';
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
import { useTheme, useToday } from './hooks';
type Page = 'widget' | SettingsPage;
export function Shell({
  storage: suppliedStorage,
  updates = findUpdate,
}: {
  storage?: Storage;
  updates?: UpdateFinder;
}) {
  const [data, setData] = useState<AppData | null>(null);
  const [page, setPage] = useState<Page>('widget');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nativeError, setNativeError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  // Правки расписания с ошибками: сохранены черновиком, но ещё не применены.
  const [draftPending, setDraftPending] = useState(false);
  const [busy, setBusy] = useState(false);
  // Ручной выбор дня действует до конца суток, затем виджет снова выбирает день сам.
  const [dayChoice, setDayChoice] = useState<{ mode: DayMode; day: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [preview, setPreview] = useState<Settings | null>(null);
  const [widgetHeight, setWidgetHeight] = useState(0);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' });
  const [dismissed, setDismissed] = useState(dismissedVersion);
  const [revision, setRevision] = useState(0);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    title?: string;
    confirmLabel?: string;
    action: () => void;
  } | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const saving = useRef(false);
  const baseStorage = useCallback(
    async () => suppliedStorage ?? (await getStorage()),
    [suppliedStorage],
  );
  const today = useToday();
  const mode = dayChoice?.day === dateKey(today) ? dayChoice.mode : 'auto';
  const chooseDay = (value: DayMode) => setDayChoice({ mode: value, day: dateKey(new Date()) });
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
          // Страховочная копия при обновлении программы и раз в день.
          void baseStorage()
            .then((s) => s.autoSnapshot?.(value))
            .catch(() => {});
        }
      } catch {
        if (!cancelled) {
          setError(
            'Не удалось загрузить расписание. Исходные данные не изменены. Повторите попытку или восстановите резервную копию.',
          );
          void showWindow().catch(() => {});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [suppliedStorage, baseStorage, attempt]);
  const checkUpdates = useCallback(
    async (manual: boolean) => {
      if (manual) setUpdateState({ phase: 'checking' });
      try {
        const found = await updates();
        setUpdate(found);
        if (manual) setUpdateState({ phase: found ? 'idle' : 'latest' });
      } catch {
        // Без интернета тихо ждём следующей проверки; сообщаем, только если просили вручную.
        if (manual)
          setUpdateState({
            phase: 'error',
            message: 'Не удалось проверить обновления. Проверьте подключение к интернету.',
          });
      }
    },
    [updates],
  );
  const autoCheck = data?.settings.checkUpdates ?? false;
  useEffect(() => {
    if (!autoCheck) return;
    const first = setTimeout(() => void checkUpdates(false), UPDATE_FIRST_CHECK);
    const repeat = setInterval(() => void checkUpdates(false), UPDATE_INTERVAL);
    return () => {
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, [autoCheck, checkUpdates]);
  async function installUpdate() {
    if (!update) return;
    try {
      const current = dataRef.current;
      // Страховочная копия до установки: при любой проблеме её можно восстановить.
      if (current) await (await baseStorage()).snapshot?.(current, 'update');
      setUpdateState({ phase: 'downloading', progress: 0 });
      await update.install((progress) =>
        setUpdateState(
          progress === 100 ? { phase: 'installing' } : { phase: 'downloading', progress },
        ),
      );
    } catch {
      setUpdateState({
        phase: 'error',
        message:
          'Не удалось установить обновление. Программа продолжит работать в текущей версии — попробуйте позже.',
      });
    }
  }
  const showUpdateBadge = !!update && dismissed !== update.version;
  const updatePanel = (
    <UpdatePanel
      update={update}
      state={updateState}
      autoCheck={autoCheck}
      dismissed={!showUpdateBadge}
      onCheck={() => void checkUpdates(true)}
      onInstall={() => guard(() => void installUpdate())}
      onDismiss={() => {
        if (!update) return;
        dismissUpdate(update.version);
        setDismissed(update.version);
      }}
    />
  );
  const editorStorage = useMemo<Storage>(
    () => ({
      load: async () => dataRef.current ?? emptyData(),
      save: persist,
      loadDraft: async () => (await (await baseStorage()).loadDraft?.()) ?? null,
      saveDraft: async (draft) => (await baseStorage()).saveDraft?.(draft),
      listSnapshots: async () => (await (await baseStorage()).listSnapshots?.()) ?? [],
      loadSnapshot: async (id) => {
        const s = await baseStorage();
        if (!s.loadSnapshot) throw new Error('Автоматические копии недоступны.');
        return s.loadSnapshot(id);
      },
    }),
    [persist, baseStorage],
  );
  const surface = page === 'widget' && step === null && !!data ? 'widget' : 'settings';
  const settings = data?.settings;
  useEffect(() => {
    document.documentElement.dataset.surface = surface;
    if (!settings) return;
    // Виджет показывается, когда известна его высота, — без скачка размера.
    if (surface === 'widget' && isTauri() && !widgetHeight) return;
    let cancelled = false;
    configureWindow(surface, settings, widgetHeight).catch(() => {
      if (!cancelled)
        setNativeError(
          'Не удалось применить поведение окна. Настройки сохранены; попробуйте открыть виджет ещё раз.',
        );
    });
    return () => {
      cancelled = true;
    };
  }, [surface, settings, revision, widgetHeight]);
  useEffect(() => {
    if (surface !== 'widget' || widgetHeight) return;
    const timer = setTimeout(() => setWidgetHeight((h) => h || 340), 1000);
    return () => clearTimeout(timer);
  }, [surface, widgetHeight]);
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
    else if (draftPending)
      setConfirmation({
        title: 'В расписании есть ошибки',
        message:
          'Правки сохранены черновиком и не пропадут, но в виджете появятся только после исправления ошибок. Выйти из редактора?',
        confirmLabel: 'Выйти, черновик сохранён',
        action: () => {
          setDraftPending(false);
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
        if (action === 'today' || action === 'next') chooseDay(action);
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
    if (!data) return;
    if (value.widgetCorner !== data.settings.widgetCorner) await resetPosition();
    await persist({ ...data, settings: value });
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
            setNativeError(
              `Позиция сброшена. Виджет вернётся в угол: ${cornerLabels[data.settings.widgetCorner].toLowerCase()}.`,
            );
          })
          .catch(() => setNativeError('Не удалось сбросить позицию.'));
      }}
      onboarding={step !== null}
    />
  ) : null;
  const restore = async (value: AppData) => {
    // Перед заменой данных — копия текущего состояния, чтобы восстановление можно было отменить.
    const current = dataRef.current;
    if (current) await (await baseStorage()).snapshot?.(current, 'before-restore');
    await persist(value);
    setStep(null);
    setPage('backups');
  };
  let content: ReactNode;
  if (loading)
    content = (
      <div className="loading-screen" role="status">
        Загружаем ваше расписание…
      </div>
    );
  else if (!data)
    content = (
      <div className="recovery-screen">
        <h1>Расписание недоступно</h1>
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((a) => a + 1)}>Повторить загрузку</button>
        <Backups data={null} onRestore={restore} storage={editorStorage} />
      </div>
    );
  else if (hidden)
    content = (
      <div className="preview-hidden">
        <span className="brand-icon">У</span>
        <h1>Виджет скрыт</h1>
        <p>В Windows его можно открыть через значок в системном трее.</p>
        <button className="primary" onClick={() => setHidden(false)}>
          Показать снова
        </button>
      </div>
    );
  else if (step !== null)
    content = (
      <Onboarding
        step={step}
        data={data}
        busy={busy}
        dirty={dirty || draftPending}
        editorStorage={editorStorage}
        preferences={commonPreferences}
        onDirty={setDraftPending}
        onStep={(next) => guard(() => setStep(next))}
        onFinish={() => void finish()}
      />
    );
  else if (page === 'widget')
    content = (
      <div className={`widget-stage ${isTauri() ? 'native' : 'browser'}`}>
        <Widget
          data={data}
          mode={mode}
          onMode={chooseDay}
          onSettings={() => navigate('schedule')}
          onClose={() => void close()}
          onLock={() => {
            if (!busy)
              void persist({
                ...data,
                settings: { ...data.settings, locked: !data.settings.locked },
              }).catch((e) => setNativeError(e.message));
          }}
          onMeasure={setWidgetHeight}
          updateAvailable={showUpdateBadge}
          onDrag={() =>
            void startDrag(data.settings.locked).catch(() =>
              setNativeError('Не удалось переместить окно.'),
            )
          }
        />
        {!isTauri() && (
          <p className="preview-caption">Предпросмотр виджета · функции окна доступны в Windows</p>
        )}
      </div>
    );
  else
    content = (
      <SettingsLayout
        page={page}
        data={data}
        editorStorage={editorStorage}
        preferences={commonPreferences}
        onDirty={setDraftPending}
        onNavigate={navigate}
        onRestore={restore}
        onOpenWizard={() => guard(() => setStep(0))}
        updatePanel={updatePanel}
        updateVersion={showUpdateBadge ? update!.version : null}
      />
    );
  return (
    <>
      {content}
      {nativeError && (
        <div className="app-notice" role="status">
          <span>{nativeError}</span>
          <button aria-label="Закрыть сообщение" onClick={() => setNativeError('')}>
            ×
          </button>
        </div>
      )}
      {confirmation && (
        <ConfirmDialog
          message={confirmation.message}
          title={confirmation.title}
          confirmLabel={confirmation.confirmLabel}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            const action = confirmation.action;
            setConfirmation(null);
            action();
          }}
        />
      )}
    </>
  );
}
