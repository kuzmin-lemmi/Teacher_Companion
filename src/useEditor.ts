import { useEffect, useRef, useState } from 'react';
import { emptyData, validate, type AppData } from './domain';
import { getStorage, type Storage } from './storage';
const AUTOSAVE_DELAY = 400;
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
/**
 * Данные редактора расписания с автосохранением: правильные данные сразу применяются,
 * с ошибками — уходят в черновик и возвращаются после перезапуска.
 * Общий для редактора на компьютере и экранов телефона.
 */
export function useEditor(storage?: Storage, onDirty?: (dirty: boolean) => void) {
  const [data, setData] = useState<AppData>(emptyData);
  const [saved, setSaved] = useState('');
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  const [sessionStart, setSessionStart] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const store = storage ?? (await getStorage());
        const value = await store.load();
        const draft = await store.loadDraft?.().catch(() => null);
        if (!cancelled) {
          const restored = draft && JSON.stringify(draft.data) !== JSON.stringify(value);
          setData(restored ? draft.data : value);
          setSaved(JSON.stringify(value));
          setSessionStart(JSON.stringify(value));
          setStatus(restored ? `Восстановлен черновик от ${clock(draft.savedAt)}` : '');
          setReady(true);
          setFailure('');
        }
      } catch {
        if (!cancelled)
          setFailure(
            'Не удалось загрузить расписание. Данные не перезаписаны. Проверьте доступ к хранилищу и повторите попытку.',
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storage, attempt]);
  const json = JSON.stringify(data);
  const errors = validate(data);
  const pending = json !== saved;
  const draftPending = ready && pending && errors.length > 0;
  useEffect(() => {
    onDirty?.(draftPending);
  }, [draftPending, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const latest = useRef({ data, json, saved, ready });
  latest.current = { data, json, saved, ready };
  const queue = useRef(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flush = useRef(() => {});
  flush.current = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const { data: value, json: text, saved: applied, ready: loaded } = latest.current;
    if (!loaded || text === applied) return;
    const valid = validate(value).length === 0;
    queue.current = queue.current.then(async () => {
      const store = storage ?? (await getStorage());
      try {
        if (valid) {
          await store.save(value);
          latest.current.saved = text;
          setSaved(text);
          await store.saveDraft?.(null);
          setStatus('Сохранено автоматически');
        } else {
          await store.saveDraft?.(value);
          setStatus(
            'Черновик сохранён. Исправьте ошибки ниже — тогда изменения появятся в виджете.',
          );
        }
        setFailed(false);
      } catch {
        // Если основная запись не удалась, правки всё равно остаются в черновике.
        await store.saveDraft?.(value).catch(() => {});
        setFailed(true);
        setStatus('Не удалось сохранить. Правки остались в редакторе и в черновике.');
      }
    });
  };
  useEffect(() => {
    if (!ready || json === saved) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush.current(), AUTOSAVE_DELAY);
  }, [json, saved, ready]);
  useEffect(() => {
    const handler = () => flush.current();
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
      flush.current();
    };
  }, []);
  function change(next: AppData) {
    setData(next);
    setStatus('');
  }
  return {
    data,
    change,
    ready,
    failure,
    retry: () => setAttempt((a) => a + 1),
    status,
    setStatus,
    errors,
    pending,
    failed,
    flush: () => flush.current(),
    /** Правки с момента открытия редактора. */
    changed: json !== sessionStart,
    revert: () => {
      setData(JSON.parse(sessionStart));
      setStatus('Изменения отменены');
    },
  };
}
