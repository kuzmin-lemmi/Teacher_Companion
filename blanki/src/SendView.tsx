/**
 * «Учителям»: подключить школу, раздать QR, назначить классное руководство и отправить расписание
 * в Teacher Companion. Ключ школы и ключ завуча хранятся только на этом компьютере.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { schoolApi, ServerError, type Fetched } from '../../src/school/api';
import type { Issue } from '../../src/school/checks';
import { generateSchoolKey } from '../../src/school/crypto';
import { addDays, capitalize, dateLabel, toIso, weekdayOf } from '../../src/school/dates';
import {
  DEFAULT_SERVER,
  encodeSchoolLink,
  parseSchoolLink,
  type SchoolLink,
} from '../../src/school/link';
import { compareClasses, lookup, type Id, type Schedule } from '../../src/school/model';
import {
  changesAhead,
  changesByTeacher,
  homeroomChanges,
  nextPublication,
  type Change,
  type Publication,
} from '../../src/school/publication';
import { copyText, download, setPageOrientation, store } from './export';

/** Всё, что нужно завучу для отправки. Хранится только в этом браузере и в файле резервной копии. */
export type Admin = SchoolLink & {
  name: string;
  publishToken: string;
  createdAt: string;
  backedUp?: boolean;
};
const ADMIN_FORMAT = 'tc-school-admin/1';

const fmt = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
const SHORT_DAYS = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
/** «пт, 13 ноября» */
const shortDate = (iso: string) =>
  `${SHORT_DAYS[weekdayOf(iso)]}, ${dateLabel(iso).split(', ')[1]}`;

function nextMonday(today: string) {
  let d = today;
  for (let i = 0; i < 7 && weekdayOf(d) !== 1; i++) d = addDays(d, 1);
  return d;
}

type Props = {
  schedule: Schedule;
  issues: Issue[];
  date: string;
  schoolName: string;
  say: (t: string) => void;
};

export function SendView({ schedule, issues, date, schoolName, say }: Props) {
  const [admin, setAdminState] = useState<Admin | null>(() =>
    store.get<Admin | null>('blanki.admin', null),
  );
  const setAdmin = (a: Admin | null) => {
    setAdminState(a);
    if (!store.set('blanki.admin', a))
      say('Не удалось сохранить в браузере — обязательно сохраните резервную копию.');
  };
  const [homerooms, setHomeroomsState] = useState<Record<Id, Id>>(() =>
    store.get('blanki.homerooms', {}),
  );
  const setHomerooms = (h: Record<Id, Id>) => {
    setHomeroomsState(h);
    store.set('blanki.homerooms', h);
  };

  if (!admin) return <Connect schoolName={schoolName} onDone={setAdmin} say={say} />;
  return (
    <div className="send">
      <Published
        admin={admin}
        setAdmin={setAdmin}
        schedule={schedule}
        issues={issues}
        date={date}
        homerooms={homerooms}
        say={say}
      />
      <Homerooms schedule={schedule} homerooms={homerooms} setHomerooms={setHomerooms} />
      <QrBlock admin={admin} setAdmin={setAdmin} say={say} />
    </div>
  );
}

// ---------- Подключение ----------

function Connect({
  schoolName,
  onDone,
  say,
}: {
  schoolName: string;
  onDone: (a: Admin) => void;
  say: (t: string) => void;
}) {
  const [name, setName] = useState(schoolName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      // Для разработки: localStorage 'blanki.server' — адрес локального сервера (server/local/dev-server.mjs).
      const server = store.get<string>('blanki.server', DEFAULT_SERVER);
      const { school, publishToken } = await schoolApi.setup(server, name.trim());
      onDone({
        server,
        school,
        key: generateSchoolKey(),
        name: name.trim(),
        publishToken,
        createdAt: new Date().toISOString(),
      });
      say('Школа подключена. Сохраните резервную копию ключей.');
    } catch (e) {
      setError(
        e instanceof ServerError && e.status === 403
          ? 'Школа на сервере уже подключена. Если это ваша школа — нажмите «Восстановить из резервной копии».'
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const restore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const a = JSON.parse(await f.text()) as Admin & { format?: string };
      if (a.format !== ADMIN_FORMAT || !a.publishToken)
        throw new Error('Это не резервная копия ключей школы.');
      await parseSchoolLink(await encodeSchoolLink(a)); // проверка ключа и номера школы
      await schoolApi.meta(a); // школа есть на сервере
      const { format: _f, ...rest } = a;
      void _f;
      onDone({ ...rest, backedUp: true });
      say('Ключи школы восстановлены.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="notice big send-card">
      <h3>Подключить школу к Teacher Companion</h3>
      <p>
        Это делается <b>один раз</b>. Программа создаст ключ школы и лист с QR-кодом для
        учительской. Учителя отсканируют его в приложении «Расписание учителя» и будут получать
        расписание отсюда.
      </p>
      <label className="field-col">
        Название школы — его увидят учителя
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="например, МАОУ Гимназия № 87"
        />
      </label>
      <div className="row">
        <button className="primary" onClick={connect} disabled={busy || !name.trim()}>
          {busy ? 'Подключаю…' : 'Подключить школу'}
        </button>
        <button onClick={() => fileRef.current?.click()}>Восстановить из резервной копии</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => void restore(e.target.files?.[0]).then(() => (e.target.value = ''))}
        />
      </div>
      {error && <div className="error">{error}</div>}
      <p className="hint">
        Расписание уходит на сервер только в зашифрованном виде. Ключ школы есть лишь на этом
        компьютере и в QR-коде — сервер его не знает.
      </p>
    </div>
  );
}

// ---------- Отправка ----------

function Published(p: {
  admin: Admin;
  setAdmin: (a: Admin | null) => void;
  schedule: Schedule;
  issues: Issue[];
  date: string;
  homerooms: Record<Id, Id>;
  say: (t: string) => void;
}) {
  const { admin, schedule } = p;
  const today = toIso(new Date());
  const [current, setCurrent] = useState<Fetched | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<'override' | 'base'>('override');
  const [validFrom, setValidFrom] = useState(nextMonday(today));
  const [anyway, setAnyway] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoadError('');
    try {
      setCurrent(await schoolApi.fetch(admin));
    } catch (e) {
      setCurrent(undefined);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.school]);

  const first = current === null;
  const effMode = first ? 'base' : mode;
  const change: Change =
    effMode === 'base'
      ? { kind: 'base', validFrom: first ? today : validFrom, schedule }
      : { kind: 'override', date: p.date, schedule };
  const built = useMemo(() => {
    if (current === undefined) return null;
    try {
      return {
        pub: nextPublication(current?.publication ?? null, change, {
          school: { id: admin.school, name: admin.name },
          homerooms: p.homerooms,
          today,
        }),
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, effMode, validFrom, p.date, schedule, p.homerooms]);
  const pub = built && 'pub' in built ? built.pub : null;
  const ahead = useMemo(
    () => (pub && current ? changesAhead(current.publication, pub, today, 14) : []),
    [pub, current, today],
  );
  const byTeacher = useMemo(() => changesByTeacher(ahead), [ahead]);
  const hr = useMemo(
    () => (pub && current ? homeroomChanges(current.publication, pub, today) : []),
    [pub, current, today],
  );

  const mismatch =
    schedule.notes && schedule.notes.cards + schedule.notes.synthesized !== schedule.entries.length;
  const errors = p.issues.filter((i) => i.level === 'error');
  const dayMissing =
    effMode === 'override' && !schedule.days.some((d) => d.n === weekdayOf(p.date));
  const nothing = !first && pub && ahead.length === 0 && hr.length === 0;
  const blocked = !pub || !!mismatch || dayMissing || (errors.length > 0 && !anyway) || busy;

  const send = async () => {
    if (!pub) return;
    setBusy(true);
    try {
      const r = await schoolApi.publish(admin, admin.publishToken, pub);
      p.say(`Отправлено учителям: версия ${r.version}`);
      setAnyway(false);
      await load();
    } catch (e) {
      p.say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const rollback = async () => {
    if (!window.confirm('Вернуть учителям расписание, которое было до последней отправки?')) return;
    setBusy(true);
    try {
      await schoolApi.rollback(admin, admin.publishToken);
      p.say('Последняя отправка отменена — у учителей прежнее расписание.');
      await load();
    } catch (e) {
      p.say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="send-card">
      <div className="send-head">
        <h3>Отправить расписание учителям</h3>
        <span className="muted">
          {admin.name || 'Школа'} ·{' '}
          {current === undefined
            ? loadError
              ? 'нет связи'
              : 'проверяю…'
            : first
              ? 'ещё ничего не отправлено'
              : `у учителей версия ${current!.version} от ${fmt(current!.publishedAt)}`}
        </span>
      </div>
      {loadError && (
        <div className="error">
          {loadError}{' '}
          <button className="link" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}

      {current !== undefined && (
        <>
          {first ? (
            <p>
              Первая отправка: учителя получат <b>основное расписание</b> из открытого файла,
              действует с сегодняшнего дня.
            </p>
          ) : (
            <div className="modes">
              <label className={mode === 'override' ? 'on' : ''}>
                <input
                  type="radio"
                  checked={mode === 'override'}
                  onChange={() => setMode('override')}
                />
                <span>
                  <b>Замены на {dateLabel(p.date)}</b>
                  <br />
                  <span className="muted">
                    Только на этот день. Дату меняйте вверху. В другие дни — основное расписание.
                  </span>
                </span>
              </label>
              <label className={mode === 'base' ? 'on' : ''}>
                <input type="radio" checked={mode === 'base'} onChange={() => setMode('base')} />
                <span>
                  <b>Новое основное расписание</b> с{' '}
                  <input
                    type="date"
                    value={validFrom}
                    min={today}
                    onChange={(e) => e.target.value && setValidFrom(e.target.value)}
                  />
                  <br />
                  <span className="muted">
                    Для изменений надолго. Замены с этой даты и позже будут сброшены.
                  </span>
                </span>
              </label>
            </div>
          )}

          <div className="preview">
            <h4>Что изменится у учителей (ближайшие две недели)</h4>
            {built && 'error' in built && <div className="error">{built.error}</div>}
            {dayMissing && (
              <div className="error">
                {capitalize(dateLabel(p.date))} — в расписании нет такого учебного дня.
              </div>
            )}
            {first && <p className="muted">Сравнивать не с чем — это первая отправка.</p>}
            {nothing && !dayMissing && (
              <p className="muted">Ничего не изменится: у учителей уже такое расписание.</p>
            )}
            {[...byTeacher].map(([t, list]) => (
              <div key={t} className="who-changes">
                <b>{t}</b>
                <ul>
                  {list.map((x, i) => (
                    <li key={i}>
                      {shortDate(x.date)}, {x.change.lesson} урок, {x.change.className}:{' '}
                      <span
                        className={`kind k-${x.change.kind === 'замена' ? 'sub' : x.change.kind === 'кабинет' ? 'room' : x.change.kind === 'отмена' ? 'off' : 'new'}`}
                      >
                        {x.change.kind}
                      </span>{' '}
                      <span className="muted">{x.change.before.join('; ') || '—'}</span> →{' '}
                      {x.change.after.join('; ') || 'урока нет'}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {hr.length > 0 && (
              <div className="who-changes">
                <b>Классное руководство</b>
                <ul>
                  {hr.map((x) => (
                    <li key={x.cls}>
                      {x.cls}: {x.before} → {x.after}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {mismatch && (
            <div className="error">
              Сверка с файлом не сошлась — отправка запрещена. Откройте выгрузку заново.
            </div>
          )}
          {errors.length > 0 && !mismatch && (
            <label className="warn-confirm">
              <input
                type="checkbox"
                checked={anyway}
                onChange={(e) => setAnyway(e.target.checked)}
              />
              В проверке есть ошибки ({errors.map((e) => e.title.toLowerCase()).join('; ')}). Всё
              равно отправить.
            </label>
          )}
          <div className="row">
            <button
              className="primary big"
              onClick={() => void send()}
              disabled={blocked || !!nothing}
            >
              {busy ? 'Отправляю…' : 'Отправить учителям'}
            </button>
            {current && current.version > 1 && (
              <button onClick={() => void rollback()} disabled={busy}>
                Отменить последнюю отправку
              </button>
            )}
          </div>
          <p className="hint">
            Учителя получат обновление в течение получаса или сразу, когда откроют приложение.
          </p>
        </>
      )}
    </section>
  );
}

// ---------- Классное руководство ----------

function Homerooms({
  schedule,
  homerooms,
  setHomerooms,
}: {
  schedule: Schedule;
  homerooms: Record<Id, Id>;
  setHomerooms: (h: Record<Id, Id>) => void;
}) {
  const [open, setOpen] = useState(Object.keys(homerooms).length > 0);
  const L = lookup(schedule);
  const used = new Set(schedule.entries.flatMap((e) => e.classes));
  const classes = schedule.classes.filter((c) => used.has(c.id)).sort(compareClasses);
  const teachers = [...schedule.teachers].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const set = (cls: Id, teacher: string, fromAsc: Id | null) => {
    const h = { ...homerooms };
    if (!teacher || teacher === fromAsc) delete h[cls];
    else h[cls] = teacher;
    setHomerooms(h);
  };
  const manual = Object.keys(homerooms).length;
  return (
    <section className="send-card">
      <div className="send-head">
        <h3>Классное руководство</h3>
        <button className="quiet" onClick={() => setOpen(!open)}>
          {open ? 'Свернуть' : 'Показать'}
        </button>
      </div>
      <p className="muted">
        Классный руководитель получит в приложении раздел «Мой класс» и сможет одной кнопкой
        отправить расписание класса в чат родителей. Берётся из aSc; здесь можно поменять
        {manual ? ` — изменено вручную: ${manual}` : ''}. Изменения уйдут учителям со следующей
        отправкой.
      </p>
      {open && (
        <table className="names hr">
          <thead>
            <tr>
              <th>Класс</th>
              <th>В aSc</th>
              <th>Классный руководитель</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c) => {
              const value = homerooms[c.id] ?? c.teacher ?? '';
              return (
                <tr key={c.id} className={homerooms[c.id] ? 'changed' : ''}>
                  <td className="orig">{c.name}</td>
                  <td className="orig">{c.teacher ? (L.teacher(c.teacher)?.name ?? '—') : '—'}</td>
                  <td>
                    <select value={value} onChange={(e) => set(c.id, e.target.value, c.teacher)}>
                      <option value="">— не назначен —</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------- QR и резервная копия ----------

function QrBlock({
  admin,
  setAdmin,
  say,
}: {
  admin: Admin;
  setAdmin: (a: Admin | null) => void;
  say: (t: string) => void;
}) {
  const [code, setCode] = useState('');
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void encodeSchoolLink(admin).then(setCode);
  }, [admin]);
  const backup = () => {
    download(
      new Blob(
        [
          JSON.stringify(
            {
              format: ADMIN_FORMAT,
              ...admin,
              backedUp: undefined,
              savedAt: new Date().toISOString(),
            },
            null,
            1,
          ),
        ],
        { type: 'application/json' },
      ),
      `ключи школы ${admin.name || admin.school}.json`,
    );
    setAdmin({ ...admin, backedUp: true });
  };
  const print = () => {
    setPageOrientation('portrait');
    document.body.classList.add('print-qr');
    window.print();
    document.body.classList.remove('print-qr');
  };
  return (
    <section className="send-card">
      <div className="send-head">
        <h3>Подключение учителей</h3>
      </div>
      {!admin.backedUp && (
        <div className="error">
          <b>Сохраните резервную копию ключей.</b> Если браузер очистится или вы смените компьютер,
          без неё отправлять расписание будет нельзя — придётся подключать школу заново и раздавать
          новый QR.{' '}
          <button className="primary" onClick={backup}>
            Сохранить резервную копию
          </button>
        </div>
      )}
      <div className="qr-row">
        <div className="qr-actions">
          <p>
            Распечатайте лист и повесьте в учительской. Учитель сканирует QR в приложении
            «Расписание учителя» на телефоне. На компьютере — вставляет код, который вы пришлёте в
            чат учителей.
          </p>
          <div className="row">
            <button className="primary" onClick={print} disabled={!code}>
              🖨 Печать листа с QR
            </button>
            <button
              onClick={async () => {
                await copyText(code);
                say('Код скопирован — вставьте его в чат учителей');
              }}
              disabled={!code}
            >
              Скопировать код для компьютера
            </button>
            {admin.backedUp && <button onClick={backup}>Резервная копия ключей</button>}
          </div>
          <p className="hint">
            У кого есть QR или код, тот видит расписание школы (уроки, классы, кабинеты). Не
            публикуйте их за пределами учительской. Резервную копию ключей храните отдельно — с ней
            можно отправлять расписание от имени завуча.
          </p>
          <button
            className="quiet"
            onClick={() => {
              if (
                window.confirm(
                  'Убрать ключи школы с этого компьютера? Отправлять расписание отсюда станет нельзя, пока не восстановите их из резервной копии.',
                )
              )
                setAdmin(null);
            }}
          >
            Убрать ключи с этого компьютера
          </button>
        </div>
        {code && <QrSheet ref={sheetRef} code={code} name={admin.name} />}
      </div>
    </section>
  );
}

const QrSheet = forwardRef<HTMLDivElement, { code: string; name: string }>(function QrSheet(
  { code, name },
  ref,
) {
  const path = useMemo(() => {
    // Лист висит на стене: средняя коррекция ошибок — переживёт блик и загнутый угол.
    const qr = qrcode(0, 'M');
    qr.addData(code, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4},${r + 4}h1v1h-1z`;
    return { d, size: n + 8 };
  }, [code]);
  return (
    <div className="qr-sheet" ref={ref}>
      <div className="qs-title">Расписание школы в телефоне</div>
      {name && <div className="qs-school">{name}</div>}
      <svg
        viewBox={`0 0 ${path.size} ${path.size}`}
        shapeRendering="crispEdges"
        className="qs-qr"
        role="img"
        aria-label="QR-код подключения к школе"
      >
        <rect width={path.size} height={path.size} fill="#fff" />
        <path d={path.d} fill="#000" />
      </svg>
      <ol className="qs-steps">
        <li>Установите «Расписание учителя» из RuStore.</li>
        <li>
          Настройки → <b>Подключиться к школе</b> → наведите камеру на этот код.
        </li>
        <li>Выберите себя из списка — ваши уроки появятся сами и будут обновляться.</li>
      </ol>
      <div className="qs-foot">Только для учителей школы. Не публикуйте этот лист в интернете.</div>
    </div>
  );
});
