import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import demoBaseXml from '../../src/school/samples/demo-asc.xml?raw';
import demoNowXml from '../../src/school/samples/demo-asc-zameny.xml?raw';
import { decodeXml, parseAscXml } from '../../src/school/asc';
import { capitalize, dateLabel, nextSchoolDay, toIso, weekdayOf } from '../../src/school/dates';
import { changedClassSlots, changedTeacherCells, diffDay } from '../../src/school/diff';
import { FORMAT, plural, type Schedule } from '../../src/school/model';
import { checkSchedule, fixTypos, type Issue } from '../../src/school/checks';
import { withNames, type NameMap } from '../../src/school/names';
import { classDayLines, classDayText } from '../../src/school/text';
import { sortedClasses, type TeacherScope } from '../../src/school/views';

const TEACHER_SCOPES: { id: TeacherScope; label: string; title: string; hint: string }[] = [
  {
    id: 'all',
    label: 'Все вместе',
    title: 'Расписание учителей',
    hint: 'Предметники, ниже — начальная школа отдельным блоком',
  },
  {
    id: 'main',
    label: 'Без начальной школы',
    title: 'Расписание учителей',
    hint: 'Только учителя-предметники',
  },
  {
    id: 'primary',
    label: 'Начальная школа',
    title: 'Расписание учителей начальных классов',
    hint: 'Только учителя начальных классов',
  },
];
import {
  copyImage,
  copyText,
  download,
  nodeToPng,
  safeName,
  setPageOrientation,
  store,
  zip,
} from './export';
import { ChangesSheet, ChatCard, TeacherSheet, type Orient } from './Sheets';
import { ClassSheet, GRADE_RANGES, type ClassLayout, type GradeRange } from './ClassSheets';

const CLASS_LAYOUTS: { id: ClassLayout; label: string; hint: string }[] = [
  { id: 'split', label: 'Предмет | Каб.', hint: 'Как бланк учителей: у каждого урока две колонки' },
  { id: 'compact', label: 'Компактно', hint: 'Одна клетка на урок: «Мат 20»' },
  { id: 'week', label: 'На неделю', hint: 'Дни сверху, в клетке — уроки по порядку' },
];

type View = 'teachers' | 'classes' | 'chat' | 'changes';
type Baseline = { schedule: Schedule; savedAt: string; demo?: boolean };
type Prefs = {
  school: string;
  chatRooms: boolean;
  chatTeachers: boolean;
  cellTeachers: boolean;
  classLayout: ClassLayout;
  classRange: GradeRange;
  fullNames: boolean;
  teacherScope: TeacherScope;
  names: NameMap;
  orient: Record<View, Orient>;
};

const DEFAULT_PREFS: Prefs = {
  school: '',
  chatRooms: true,
  chatTeachers: false,
  cellTeachers: false,
  teacherScope: 'all',
  classLayout: 'split',
  classRange: '5-11',
  fullNames: true,
  names: {},
  orient: { teachers: 'portrait', classes: 'landscape', chat: 'portrait', changes: 'portrait' },
};
const VIEWS: { id: View; label: string }[] = [
  { id: 'teachers', label: 'Учителя' },
  { id: 'classes', label: 'Классы' },
  { id: 'chat', label: 'Для чатов' },
  { id: 'changes', label: 'Замены' },
];

async function readSchedule(file: File): Promise<Schedule> {
  const text = decodeXml(new Uint8Array(await file.arrayBuffer()));
  if (text.trimStart().startsWith('{')) {
    const json = JSON.parse(text) as Schedule;
    if (json.format !== FORMAT) throw new Error('Это не файл расписания tc-school/1.');
    return json;
  }
  return parseAscXml(text, file.name);
}

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export default function App() {
  const [raw, setSchedule] = useState<Schedule | null>(null);
  const [rawBaseline, setBaseline] = useState<Baseline | null>(() =>
    store.get<Baseline | null>('blanki.baseline', null),
  );
  const [prefs, setPrefsState] = useState<Prefs>(() => ({
    ...DEFAULT_PREFS,
    ...store.get<Partial<Prefs>>('blanki.prefs', {}),
  }));
  const [namesOpen, setNamesOpen] = useState(false);
  // Названия, исправленные завучем здесь, применяются и к открытому, и к основному расписанию.
  const schedule = useMemo(() => raw && withNames(raw, prefs.names), [raw, prefs.names]);
  const baseline = useMemo(
    () => rawBaseline && { ...rawBaseline, schedule: withNames(rawBaseline.schedule, prefs.names) },
    [rawBaseline, prefs.names],
  );
  const issues = useMemo(() => (schedule ? checkSchedule(schedule) : []), [schedule]);
  const [view, setView] = useState<View>('teachers');
  const [date, setDate] = useState(() => nextSchoolDay(new Date(), 5));
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const baseInput = useRef<HTMLInputElement>(null);

  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((old) => {
      const next = { ...old, ...p };
      store.set('blanki.prefs', next);
      return next;
    });
  const say = (t: string) => {
    setToast(t);
    window.setTimeout(() => setToast(''), 2600);
  };

  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      const s = await readSchedule(file);
      setSchedule(s);
      setError('');
      if (rawBaseline?.demo) setBaseline(store.get<Baseline | null>('blanki.baseline', null));
      setDate(nextSchoolDay(new Date(), s.days.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const openDemo = () => {
    const now = parseAscXml(demoNowXml, 'демо: расписание с заменами');
    setSchedule(now);
    setBaseline({
      schedule: parseAscXml(demoBaseXml, 'демо: основное расписание'),
      savedAt: new Date().toISOString(),
      demo: true,
    });
    const d = new Date();
    while (d.getDay() !== 5) d.setDate(d.getDate() + 1);
    setDate(toIso(d));
    setError('');
  };

  const rememberBaseline = (s: Schedule) => {
    const b = { schedule: s, savedAt: new Date().toISOString() };
    if (!store.set('blanki.baseline', b))
      say('Не удалось сохранить в браузере — основное расписание будет только до закрытия');
    else say('Сохранено как основное расписание');
    setBaseline(b);
  };

  const day = weekdayOf(date);
  const dayExists = !!schedule?.days.some((d) => d.n === day);
  const dateText = capitalize(dateLabel(date));
  const title = (what: string) => (prefs.school ? `${prefs.school} — ${what}` : what);
  const orient = prefs.orient[view];

  const diff = useMemo(() => {
    if (!schedule || !baseline || !dayExists || baseline.schedule === schedule) return null;
    const changes = diffDay(baseline.schedule, schedule, day);
    return {
      changes,
      classSlots: changedClassSlots(changes),
      teacherCells: changedTeacherCells(baseline.schedule, schedule, day),
    };
  }, [schedule, baseline, day, dayExists]);

  useEffect(() => setPageOrientation(orient), [orient]);

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const fileBase = `${date} ${VIEWS.find((v) => v.id === view)!.label}`;
  const savePng = () =>
    withBusy(async () => {
      if (sheetRef.current)
        download(await nodeToPng(sheetRef.current), `${safeName(fileBase)}.png`);
    });
  const copyPng = () =>
    withBusy(async () => {
      if (!sheetRef.current) return;
      await copyImage(await nodeToPng(sheetRef.current));
      say('Картинка скопирована — вставьте в чат (Ctrl+V)');
    });
  const print = () => {
    setPageOrientation(orient);
    window.print();
  };
  const saveJson = () => {
    if (!schedule) return;
    download(
      new Blob([JSON.stringify(schedule, null, 1)], { type: 'application/json' }),
      `расписание ${toIso(new Date())}.tc-school.json`,
    );
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void open(e.dataTransfer.files[0]);
  };

  return (
    <div
      className={`app ${dragOver ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={fileInput}
        type="file"
        accept=".xml,.json"
        hidden
        onChange={(e) => void open(e.target.files?.[0]).then(() => (e.target.value = ''))}
      />
      <input
        ref={baseInput}
        type="file"
        accept=".xml,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            rememberBaseline(await readSchedule(f));
          } catch (err) {
            say(err instanceof Error ? err.message : String(err));
          }
        }}
      />

      <header className="bar no-print">
        <div className="brand">
          <span className="logo">▦</span> Бланки расписания
        </div>
        {schedule && (
          <>
            <button
              className="file"
              onClick={() => fileInput.current?.click()}
              title="Открыть другую выгрузку"
            >
              📄 {schedule.source.file || 'расписание'}
            </button>
            <label className="field">
              Дата
              <input
                type="date"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </label>
            <div className="tabs">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  className={v.id === view ? 'on' : ''}
                  onClick={() => setView(v.id)}
                >
                  {v.label}
                  {v.id === 'changes' && diff && diff.changes.length > 0 && (
                    <span className="count">{diff.changes.length}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="spacer" />
            {view !== 'chat' && (
              <>
                <select
                  value={orient}
                  onChange={(e) =>
                    setPrefs({ orient: { ...prefs.orient, [view]: e.target.value as Orient } })
                  }
                  title="Ориентация листа"
                >
                  <option value="portrait">Книжная</option>
                  <option value="landscape">Альбомная</option>
                </select>
                <button className="primary" onClick={print} disabled={!dayExists}>
                  🖨 Печать
                </button>
                <button onClick={savePng} disabled={busy || !dayExists}>
                  PNG
                </button>
                <button
                  onClick={copyPng}
                  disabled={busy || !dayExists}
                  title="Скопировать картинку и вставить в чат"
                >
                  Копировать картинку
                </button>
              </>
            )}
          </>
        )}
      </header>

      {!schedule ? (
        <Welcome onOpen={() => fileInput.current?.click()} onDemo={openDemo} error={error} />
      ) : (
        <>
          <InfoBar
            schedule={schedule}
            baseline={baseline}
            prefs={prefs}
            setPrefs={setPrefs}
            onRemember={() => rememberBaseline(raw!)}
            onLoadBase={() => baseInput.current?.click()}
            onForget={() => {
              store.set('blanki.baseline', null);
              setBaseline(null);
            }}
            onJson={saveJson}
            error={error}
            issues={issues}
            onNames={() => setNamesOpen(true)}
          />
          {namesOpen && (
            <NamesDialog
              raw={raw!}
              prefs={prefs}
              setPrefs={setPrefs}
              onClose={() => setNamesOpen(false)}
            />
          )}
          <main className="stage">
            {!dayExists ? (
              <div className="notice">
                {dateText}: в расписании нет этого дня. Выберите учебный день — в выгрузке дни{' '}
                {schedule.days.map((d) => d.short).join(', ')}.
              </div>
            ) : view === 'teachers' ? (
              <>
                <div className="sheet-opts no-print">
                  <div className="tabs">
                    {TEACHER_SCOPES.map((t) => (
                      <button
                        key={t.id}
                        className={prefs.teacherScope === t.id ? 'on' : ''}
                        onClick={() => setPrefs({ teacherScope: t.id })}
                        title={t.hint}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Paper>
                  <TeacherSheet
                    ref={sheetRef}
                    s={schedule}
                    day={day}
                    title={title(TEACHER_SCOPES.find((t) => t.id === prefs.teacherScope)!.title)}
                    date={dateText}
                    orient={orient}
                    changed={diff?.teacherCells ?? new Set()}
                    scope={prefs.teacherScope}
                  />
                </Paper>
              </>
            ) : view === 'classes' ? (
              <>
                <div className="sheet-opts no-print">
                  <div className="tabs">
                    {CLASS_LAYOUTS.map((l) => (
                      <button
                        key={l.id}
                        className={prefs.classLayout === l.id ? 'on' : ''}
                        onClick={() => setPrefs({ classLayout: l.id })}
                        title={l.hint}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <select
                    value={prefs.classRange}
                    onChange={(e) => setPrefs({ classRange: e.target.value as GradeRange })}
                  >
                    {GRADE_RANGES.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                  <label title="«Литература» вместо «Л» — понятнее ученикам">
                    <input
                      type="checkbox"
                      checked={prefs.fullNames}
                      onChange={(e) => setPrefs({ fullNames: e.target.checked })}
                    />{' '}
                    полные названия
                  </label>
                  <button className="quiet" onClick={() => setNamesOpen(true)}>
                    Названия предметов…
                  </button>
                  {prefs.classLayout !== 'week' && (
                    <label>
                      <input
                        type="checkbox"
                        checked={prefs.cellTeachers}
                        onChange={(e) => setPrefs({ cellTeachers: e.target.checked })}
                      />{' '}
                      учителя в клетках
                    </label>
                  )}
                </div>
                <Paper>
                  <ClassSheet
                    ref={sheetRef}
                    s={schedule}
                    day={day}
                    title={title(
                      prefs.classLayout === 'week' ? 'Расписание уроков' : 'Расписание классов',
                    )}
                    date={dateText}
                    orient={orient}
                    changed={diff?.classSlots ?? new Set()}
                    showTeachers={prefs.cellTeachers}
                    fullNames={prefs.fullNames}
                    layout={prefs.classLayout}
                    range={prefs.classRange}
                  />
                </Paper>
              </>
            ) : view === 'changes' ? (
              !baseline || baseline.schedule === schedule ? (
                <NoBaseline
                  hasBase={!!baseline}
                  onRemember={() => rememberBaseline(raw!)}
                  onLoad={() => baseInput.current?.click()}
                />
              ) : (
                <Paper>
                  <ChangesSheet
                    ref={sheetRef}
                    s={schedule}
                    changes={diff?.changes ?? []}
                    title={title('Изменения в расписании')}
                    date={dateText}
                    orient={orient}
                    baseNote={`по сравнению с основным расписанием от ${fmtStamp(baseline.savedAt)}`}
                  />
                </Paper>
              )
            ) : (
              <ChatView
                schedule={schedule}
                day={day}
                date={date}
                prefs={prefs}
                setPrefs={setPrefs}
                changed={diff?.classSlots ?? new Set()}
                say={say}
              />
            )}
          </main>
        </>
      )}
      {toast && <div className="toast no-print">{toast}</div>}
      {dragOver && <div className="drop-hint no-print">Отпустите файл выгрузки aSc</div>}
    </div>
  );
}

function Paper({ children }: { children: ReactNode }) {
  return <div className="paper">{children}</div>;
}

function Welcome({
  onOpen,
  onDemo,
  error,
}: {
  onOpen: () => void;
  onDemo: () => void;
  error: string;
}) {
  return (
    <main className="welcome">
      <div className="drop" onClick={onOpen} role="button" tabIndex={0}>
        <div className="drop-icon">⇪</div>
        <div className="drop-title">Перетащите сюда выгрузку из aSc</div>
        <div className="drop-sub">или нажмите, чтобы выбрать файл (.xml)</div>
      </div>
      {error && <div className="error">{error}</div>}
      <ol className="steps">
        <li>
          В aSc Расписание: <b>Файл → Экспорт</b> → формат <b>aSc XML</b> (точное название пункта
          может немного отличаться). Сохраните файл.
        </li>
        <li>Откройте его здесь и выберите дату.</li>
        <li>
          Печатайте бланки, сохраняйте картинки и копируйте текст в чаты. Если один раз запомнить
          основное расписание, на вкладке <b>«Замены»</b> лист замен будет собираться сам.
        </li>
      </ol>
      <button className="link" onClick={onDemo}>
        Посмотреть на примере вымышленной школы →
      </button>
      <p className="privacy">
        Файл никуда не отправляется: всё считается на этом компьютере, без интернета.
      </p>
    </main>
  );
}

function InfoBar(p: {
  schedule: Schedule;
  baseline: Baseline | null;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  onRemember: () => void;
  onLoadBase: () => void;
  onForget: () => void;
  onJson: () => void;
  error: string;
  issues: Issue[];
  onNames: () => void;
}) {
  const s = p.schedule;
  const errors = p.issues.filter((i) => i.level === 'error').length;
  const [open, setOpen] = useState(errors > 0);
  const count = (lvl: Issue['level']) => p.issues.filter((i) => i.level === lvl).length;
  const classesUsed = new Set(s.entries.flatMap((e) => e.classes)).size;
  const teachersUsed = new Set(s.entries.flatMap((e) => e.teachers)).size;
  return (
    <section className="info no-print">
      <div className="facts">
        <span>
          Учителей <b>{teachersUsed}</b>
        </span>
        <span>
          Классов <b>{classesUsed}</b>
        </span>
        <span>
          Уроков в неделю <b>{s.entries.length}</b>
        </span>
        {s.notes && (
          <span
            className={
              s.notes.cards + s.notes.synthesized === s.entries.length ? 'check-ok' : 'error-inline'
            }
            title="Каждая карточка из файла aSc должна попасть в расписание ровно один раз"
          >
            {s.notes.cards + s.notes.synthesized === s.entries.length ? '✓' : '⚠'} Сверка с файлом:
            карточек {s.notes.cards}
            {s.notes.synthesized > 0 && ` + ${s.notes.synthesized} вторых половин пар`} → уроков{' '}
            {s.entries.length}
          </span>
        )}
        {p.issues.length === 0 ? (
          <span className="check-ok">✓ Проверка: ошибок не найдено</span>
        ) : (
          <button className={`check-btn ${errors ? 'has-err' : ''}`} onClick={() => setOpen(!open)}>
            Проверка расписания:
            {count('error') > 0 && (
              <span className="lv lv-error">
                {count('error')} {plural(count('error'), 'ошибка', 'ошибки', 'ошибок')}
              </span>
            )}
            {count('warn') > 0 && (
              <span className="lv lv-warn">
                {count('warn')} {plural(count('warn'), 'замечание', 'замечания', 'замечаний')}
              </span>
            )}
            {count('info') > 0 && <span className="lv lv-info">{count('info')} к сведению</span>}
            {open ? ' ▴' : ' ▾'}
          </button>
        )}
        <label className="school">
          Заголовок
          <input
            value={p.prefs.school}
            placeholder="например, МБОУ СОШ № 1"
            onChange={(e) => p.setPrefs({ school: e.target.value })}
          />
        </label>
      </div>
      <div className="base">
        {p.baseline ? (
          <>
            Основное расписание:{' '}
            <b>{p.baseline.demo ? 'демо' : `от ${fmtStamp(p.baseline.savedAt)}`}</b>
            {p.baseline.schedule === s && ' (открыто сейчас)'}
          </>
        ) : (
          'Основное расписание не задано'
        )}
        <button onClick={p.onRemember} title="Запомнить открытый файл как расписание без замен">
          Запомнить открытое как основное
        </button>
        <button onClick={p.onLoadBase}>Загрузить основное из файла</button>
        {p.baseline && !p.baseline.demo && (
          <button className="quiet" onClick={p.onForget}>
            Забыть
          </button>
        )}
        <button
          className="quiet"
          onClick={p.onJson}
          title="Тот же формат потом получит Teacher Companion"
        >
          Сохранить JSON
        </button>
      </div>
      {open && p.issues.length > 0 && (
        <IssuesPanel issues={p.issues} prefs={p.prefs} setPrefs={p.setPrefs} onNames={p.onNames} />
      )}
      {p.error && <div className="error">{p.error}</div>}
    </section>
  );
}

const LEVEL_ICON: Record<Issue['level'], string> = { error: '⛔', warn: '⚠', info: 'ℹ' };

function IssuesPanel({
  issues,
  prefs,
  setPrefs,
  onNames,
}: {
  issues: Issue[];
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  onNames: () => void;
}) {
  return (
    <div className="issues">
      <p className="issues-lead">
        Программа проверила выгрузку из aSc. Исправлять лучше в самой aSc, потом снова сделать
        экспорт и открыть файл здесь — проверка пройдёт заново.
      </p>
      {issues.map((i) => (
        <IssueCard key={i.id} issue={i}>
          {i.renames && (
            <div className="row">
              <button
                className="primary"
                onClick={() =>
                  setPrefs({
                    names: {
                      ...prefs.names,
                      ...Object.fromEntries(i.renames!.map((r) => [r.from, r.to])),
                    },
                  })
                }
              >
                Исправить для бланков
              </button>
              <button onClick={onNames}>Открыть названия предметов</button>
            </div>
          )}
        </IssueCard>
      ))}
    </div>
  );
}

function IssueCard({ issue: i, children }: { issue: Issue; children?: ReactNode }) {
  const [all, setAll] = useState(false);
  const LIMIT = 6;
  const shown = all ? i.items : i.items.slice(0, LIMIT);
  return (
    <div className={`issue lvl-${i.level}`}>
      <div className="issue-head">
        <span className="issue-icon">{LEVEL_ICON[i.level]}</span>
        <b>{i.title}</b>
        <span className="issue-count">{i.items.length}</span>
      </div>
      <div className="issue-body">
        <p>
          <span className="muted">Что будет: </span>
          {i.why}
        </p>
        <p>
          <span className="muted">Как исправить: </span>
          {i.fix}
        </p>
        <ul>
          {shown.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {i.items.length > LIMIT && (
          <button className="link" onClick={() => setAll(!all)}>
            {all ? 'Свернуть' : `Показать все (${i.items.length})`}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

/** Названия предметов для бланков: исправить опечатку или сократить длинное — без правки aSc. */
function NamesDialog({
  raw,
  prefs,
  setPrefs,
  onClose,
}: {
  raw: Schedule;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  onClose: () => void;
}) {
  const used = new Set(raw.entries.map((e) => e.subject));
  const subjects = raw.subjects
    .filter((x) => used.has(x.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const set = (from: string, to: string) => {
    const names = { ...prefs.names };
    if (!to.trim() || to.trim() === from) delete names[from];
    else names[from] = to;
    setPrefs({ names });
  };
  return (
    <div className="modal-back no-print" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Названия предметов на бланках</h3>
          <button className="quiet" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="hint">
          Слева — как записано в aSc. Справа можно поправить опечатку или сделать название понятнее
          ученикам. В aSc ничего не меняется, исправления запоминаются на этом компьютере. Пустое
          поле — как в aSc.
        </p>
        <table className="names">
          <thead>
            <tr>
              <th>Кратко в aSc</th>
              <th>Кратко на бланке учителей</th>
              <th>Полностью в aSc</th>
              <th>Полностью — ученикам и в чаты</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((x) => {
              const sugShort = fixTypos(x.short);
              const sugName = fixTypos(x.name);
              return (
                <tr key={x.id}>
                  <td className="orig">{x.short}</td>
                  <td>
                    <input
                      value={prefs.names[x.short] ?? ''}
                      placeholder={sugShort !== x.short ? `${sugShort} ?` : x.short}
                      onChange={(e) => set(x.short, e.target.value)}
                    />
                  </td>
                  <td className="orig">{x.name}</td>
                  <td>
                    <input
                      value={prefs.names[x.name] ?? ''}
                      placeholder={sugName !== x.name ? `${sugName} ?` : x.name}
                      onChange={(e) => set(x.name, e.target.value)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row">
          <button className="primary" onClick={onClose}>
            Готово
          </button>
          {Object.keys(prefs.names).length > 0 && (
            <button className="quiet" onClick={() => setPrefs({ names: {} })}>
              Вернуть все названия как в aSc
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function NoBaseline({
  hasBase,
  onRemember,
  onLoad,
}: {
  hasBase: boolean;
  onRemember: () => void;
  onLoad: () => void;
}) {
  return (
    <div className="notice big">
      <h3>Лист замен собирается сам — нужно только основное расписание</h3>
      {hasBase ? (
        <p>
          Сейчас открыто само основное расписание, сравнивать не с чем. Сделайте замены в aSc, снова
          выгрузите XML и откройте новый файл.
        </p>
      ) : (
        <ol>
          <li>
            Откройте выгрузку обычного расписания (без замен) и нажмите «Запомнить как основное».
            Это делается один раз в четверть.
          </li>
          <li>
            Каждый раз после замен в aSc выгружайте XML и открывайте его здесь: изменения
            подсветятся, а на этой вкладке появится лист замен.
          </li>
        </ol>
      )}
      <div className="row">
        {!hasBase && (
          <button className="primary" onClick={onRemember}>
            Запомнить открытое как основное
          </button>
        )}
        <button onClick={onLoad}>Загрузить основное из файла</button>
      </div>
    </div>
  );
}

function ChatView(p: {
  schedule: Schedule;
  day: number;
  date: string;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  changed: Set<string>;
  say: (t: string) => void;
}) {
  const { schedule: s, day, date, prefs } = p;
  const classes = sortedClasses(s);
  const [clsId, setClsId] = useState(classes[0]?.id ?? '');
  const cls = classes.find((c) => c.id === clsId) ?? classes[0];
  const label = dateLabel(date);
  const opts = { rooms: prefs.chatRooms, teachers: prefs.chatTeachers };
  const generated = cls ? classDayText(s, cls.id, day, label, opts) : '';
  const [text, setText] = useState(generated);
  useEffect(() => setText(generated), [generated]);
  const cardRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const allRefs = useRef<(HTMLDivElement | null)[]>([]);

  const changedLessons = (name: string) =>
    new Set(
      [...p.changed].filter((k) => k.startsWith(`${name}|`)).map((k) => Number(k.split('|')[1])),
    );
  const card = (c: (typeof classes)[number], ref: React.Ref<HTMLDivElement>) => (
    <ChatCard
      ref={ref}
      cls={c.name}
      date={capitalize(label)}
      lines={classDayLines(s, c.id, day)}
      changed={changedLessons(c.name)}
      rooms={prefs.chatRooms}
      school={prefs.school}
    />
  );

  const zipAll = async () => {
    setExporting(true);
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const files = [];
      for (let i = 0; i < classes.length; i++) {
        const node = allRefs.current[i];
        if (node)
          files.push({ name: `${safeName(classes[i].name)}.png`, blob: await nodeToPng(node) });
      }
      download(await zip(files), `${date} картинки классов.zip`);
    } catch (e) {
      p.say(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  if (!cls) return <div className="notice">В выгрузке нет классов с уроками.</div>;
  return (
    <div className="chat-view">
      <div className="chips no-print">
        {classes.map((c) => (
          <button key={c.id} className={c.id === cls.id ? 'on' : ''} onClick={() => setClsId(c.id)}>
            {c.name}
            {changedLessons(c.name).size > 0 && <i className="dot" />}
          </button>
        ))}
      </div>
      <div className="chat-grid">
        <div className="chat-pic">
          {card(cls, cardRef)}
          <div className="row no-print">
            <button
              className="primary"
              onClick={async () => {
                if (!cardRef.current) return;
                await copyImage(await nodeToPng(cardRef.current));
                p.say('Картинка скопирована — вставьте в чат (Ctrl+V)');
              }}
            >
              Копировать картинку
            </button>
            <button
              onClick={async () =>
                cardRef.current &&
                download(await nodeToPng(cardRef.current), `${date} ${safeName(cls.name)}.png`)
              }
            >
              PNG
            </button>
            <button onClick={zipAll} disabled={exporting}>
              {exporting ? 'Готовлю…' : `Все классы (ZIP, ${classes.length})`}
            </button>
          </div>
        </div>
        <div className="chat-text no-print">
          <div className="row">
            <label>
              <input
                type="checkbox"
                checked={prefs.chatRooms}
                onChange={(e) => p.setPrefs({ chatRooms: e.target.checked })}
              />{' '}
              кабинеты
            </label>
            <label>
              <input
                type="checkbox"
                checked={prefs.chatTeachers}
                onChange={(e) => p.setPrefs({ chatTeachers: e.target.checked })}
              />{' '}
              учителя
            </label>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <div className="row">
            <button
              className="primary"
              onClick={async () => {
                await copyText(text);
                p.say('Текст скопирован — вставьте в чат');
              }}
            >
              Копировать текст
            </button>
            {text !== generated && (
              <button onClick={() => setText(generated)}>Вернуть как было</button>
            )}
          </div>
          <p className="hint">
            Текст можно поправить перед отправкой, например дописать «не забудьте форму». Правка не
            сохраняется.
          </p>
        </div>
      </div>
      {exporting && (
        <div className="offscreen" aria-hidden>
          {classes.map((c, i) => (
            <div key={c.id}>{card(c, (el) => void (allRefs.current[i] = el))}</div>
          ))}
        </div>
      )}
    </div>
  );
}
