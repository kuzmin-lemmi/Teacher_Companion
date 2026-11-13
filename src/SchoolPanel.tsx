import { useMemo, useState } from 'react';
import { isoDate, type AppData } from './domain';
import { ScanOverlay } from './QrTransfer';
import { schoolApi, type Fetched } from './school/api';
import { parseSchoolLink, type SchoolLink } from './school/link';
import {
  applySchool,
  checkSchool,
  disconnectSchool,
  schoolStamp,
  teacherChoices,
} from './schoolMode';
import { applyWithChanges } from './schoolChanges';

export type SchoolChange = (
  change: (current: AppData) => AppData,
  firstConnect?: boolean,
) => Promise<void>;

/**
 * «Школа»: подключиться по QR-коду из учительской (телефон) или по коду из чата учителей (компьютер),
 * выбрать себя — и уроки будут приходить от завуча сами.
 */
export function SchoolPanel({
  data,
  onChange,
  mobile,
}: {
  data: AppData;
  onChange: SchoolChange;
  mobile: boolean;
}) {
  const st = data.school;
  const [step, setStep] = useState<'start' | 'who'>('start');
  const [fetched, setFetched] = useState<{ link: SchoolLink; value: Fetched } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Код школы прочитан — скачать расписание и показать «Кто вы?». */
  const open = (code: string) =>
    run(async () => {
      const link = await parseSchoolLink(code);
      const value = await schoolApi.fetch(link);
      if (!value) throw new Error('Завуч ещё не отправил расписание. Попробуйте позже.');
      setFetched({ link, value });
      setStep('who');
    });

  const choose = (teacherId: string) =>
    run(async () => {
      const f = fetched!;
      await onChange((current) => applySchool(current, f.value, f.link, teacherId), !data.school);
      setStep('start');
      setFetched(null);
      setStatus('Готово: уроки из школы уже в расписании.');
    });

  if (step === 'who' && fetched)
    return (
      <WhoAreYou
        fetched={fetched.value}
        current={st?.teacherId}
        busy={busy}
        error={error}
        onPick={(id) => void choose(id)}
        onBack={() => {
          setStep('start');
          setError('');
        }}
        replacesOwn={!st && data.lessons.length > 0}
      />
    );

  if (!st)
    return (
      <section className="panel school">
        <p className="eyebrow">РАСПИСАНИЕ ОТ ЗАВУЧА</p>
        <h2>Подключиться к школе</h2>
        <p className="muted">
          Если ваша школа ведёт расписание в aSc, завуч может присылать его сюда. Уроки и замены
          будут появляться сами — вводить ничего не нужно.
        </p>
        {mobile ? (
          <ScanButton disabled={busy} onCode={(c) => void open(c)} onError={setError} />
        ) : null}
        <PasteCode disabled={busy} onCode={(c) => void open(c)} mobile={mobile} />
        {busy && <p className="hint">Получаю расписание школы…</p>}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </section>
    );

  const check = () =>
    run(async () => {
      const r = await checkSchool({ ...data, school: { ...st, version: -1 } });
      if (r.kind === 'error') throw new Error(r.message);
      if (r.kind === 'update') {
        await onChange((current) =>
          current.school ? applyWithChanges(current, r.fetched, r.link, r.teacherId).data : current,
        );
        setStatus(
          r.fetched.version === st.version
            ? 'Расписание актуально.'
            : `Обновлено: версия от ${schoolStamp(r.fetched.publishedAt)}.`,
        );
      }
    });

  return (
    <section className="panel school">
      <p className="eyebrow">РАСПИСАНИЕ ОТ ЗАВУЧА</p>
      <h2>{st.schoolName || 'Школа'}</h2>
      <dl className="school-facts">
        <dt>Вы</dt>
        <dd>{st.teacherName}</dd>
        {st.homeroomClass && (
          <>
            <dt>Классное руководство</dt>
            <dd>{st.homeroomClass} — расписание класса в «Моём классе»</dd>
          </>
        )}
        <dt>Расписание от</dt>
        <dd>{schoolStamp(st.publishedAt)}</dd>
        {data.schoolDays && Object.keys(data.schoolDays).length > 0 && (
          <>
            <dt>Замены</dt>
            <dd>
              {Object.keys(data.schoolDays)
                .filter((d) => d >= isoDate(new Date()))
                .slice(0, 6)
                .map((d) =>
                  new Date(d + 'T12:00').toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    weekday: 'short',
                  }),
                )
                .join(', ') || 'нет'}
            </dd>
          </>
        )}
      </dl>
      <p className="hint">
        Уроки обновляются сами: при запуске и раз в полчаса. Свои правки уроков здесь не сохранятся
        — их заменит расписание школы.
      </p>
      <div className="backup-actions">
        <button className="primary" disabled={busy} onClick={() => void check()}>
          {busy ? 'Проверяю…' : 'Проверить обновления'}
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const link = { server: st.server, school: st.school, key: st.key };
              const value = await schoolApi.fetch(link);
              if (!value) throw new Error('На сервере нет расписания школы.');
              setFetched({ link, value });
              setStep('who');
            })
          }
        >
          Выбрать другого учителя
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Отключиться от школы? Вернётся ваше прежнее расписание, обновления от завуча приходить перестанут.',
              )
            )
              void run(async () => {
                await onChange((current) => disconnectSchool(current));
                setStatus('Отключено. Вернулось ваше прежнее расписание.');
              });
          }}
        >
          Отключиться от школы
        </button>
      </div>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  );
}

function PasteCode({
  onCode,
  disabled,
  mobile,
}: {
  onCode: (code: string) => void;
  disabled: boolean;
  mobile: boolean;
}) {
  const [code, setCode] = useState('');
  return (
    <div className="school-paste">
      <label>
        {mobile
          ? 'Или вставьте код школы из чата учителей'
          : 'Код школы — завуч присылает его в чат учителей'}
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="tcs:1?s=…"
          rows={3}
          spellCheck={false}
        />
      </label>
      <button
        className={mobile ? 'secondary' : 'primary'}
        disabled={disabled || !code.trim()}
        onClick={() => onCode(code)}
      >
        Подключиться
      </button>
    </div>
  );
}

function ScanButton({
  onCode,
  onError,
  disabled,
}: {
  onCode: (code: string) => void;
  onError: (e: string) => void;
  disabled: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  async function start() {
    onError('');
    const scanner = await import('@tauri-apps/plugin-barcode-scanner');
    try {
      let permission = await scanner.checkPermissions();
      if (permission !== 'granted') permission = await scanner.requestPermissions();
      if (permission !== 'granted') {
        onError(
          'Нет доступа к камере. Разрешите его: Настройки телефона → Приложения → Расписание учителя → Разрешения.',
        );
        return;
      }
      document.documentElement.classList.add('scanning');
      setScanning(true);
      const result = await scanner.scan({ windowed: true, formats: [scanner.Format.QRCode] });
      onCode(result.content);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/cancel/i.test(message)) onError(message || 'Не удалось прочитать QR-код.');
    } finally {
      document.documentElement.classList.remove('scanning');
      setScanning(false);
    }
  }
  return (
    <>
      <button className="primary" disabled={disabled || scanning} onClick={() => void start()}>
        Сканировать QR-код школы
      </button>
      {scanning && (
        <ScanOverlay
          text="Наведите камеру на QR-код на листе в учительской"
          onCancel={() =>
            void import('@tauri-apps/plugin-barcode-scanner').then((s) =>
              s.cancel().catch(() => {}),
            )
          }
        />
      )}
    </>
  );
}

function WhoAreYou(p: {
  fetched: Fetched;
  current?: string;
  busy: boolean;
  error: string;
  replacesOwn: boolean;
  onPick: (id: string) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const all = useMemo(
    () => teacherChoices(p.fetched.publication, isoDate(new Date())),
    [p.fetched],
  );
  const list = all.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));
  const chosen = all.find((t) => t.id === picked);
  return (
    <section className="panel school">
      <p className="eyebrow">{p.fetched.publication.school.name || 'ШКОЛА'}</p>
      <h2>Кто вы?</h2>
      <input
        className="school-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Начните вводить фамилию"
        autoFocus
      />
      <div className="school-list" role="listbox" aria-label="Учителя школы">
        {list.map((t) => (
          <button
            key={t.id}
            role="option"
            aria-selected={picked === t.id}
            className={`school-teacher ${picked === t.id ? 'on' : ''} ${p.current === t.id ? 'current' : ''}`}
            onClick={() => setPicked(t.id)}
          >
            <span>{t.name}</span>
            <small>
              {t.tag && `${t.tag} · `}
              {t.lessons} ур. в неделю
            </small>
          </button>
        ))}
        {!list.length && <p className="hint">Никого не нашлось.</p>}
      </div>
      {chosen && (
        <div className="school-confirm">
          <p>
            <b>{chosen.name}</b> — {chosen.lessons} уроков в неделю.
            {p.replacesOwn &&
              ' Ваше нынешнее расписание заменится расписанием школы; оно сохранится и вернётся, если отключиться от школы.'}
          </p>
          <button className="primary" disabled={p.busy} onClick={() => p.onPick(chosen.id)}>
            {p.busy ? 'Подключаю…' : 'Это я'}
          </button>
        </div>
      )}
      {p.error && (
        <p role="alert" className="error-text">
          {p.error}
        </p>
      )}
      <button className="secondary" onClick={p.onBack}>
        Назад
      </button>
    </section>
  );
}
