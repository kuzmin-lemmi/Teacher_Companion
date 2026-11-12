/**
 * Разбор выгрузки aSc Расписание в XML («Файл → Экспорт → aSc XML»).
 *
 * Что берём из файла:
 *  - <period>   — номера уроков и звонки;
 *  - <daysdef>  — названия дней (маска вида "10000" — понедельник);
 *  - <subject>, <teacher>, <classroom>, <class>, <group> — справочники;
 *  - <lesson>   — нагрузка: кто, что, каким классам/группам, сколько уроков подряд;
 *  - <card>     — постановка урока в клетку: день, номер урока, кабинет.
 *
 * Работает и в браузере, и в Tauri/Teacher Companion — нужен только DOMParser.
 */
import {
  FORMAT,
  type Bell,
  type Day,
  type Entry,
  type ParseNotes,
  type Schedule,
  type SchoolClass,
} from './model';

const RU_DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const RU_DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Байты файла → текст. aSc часто пишет windows-1251; кодировку берём из заголовка XML. */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 300));
  const enc = /encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(enc.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const ids = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** "8:00" → "08:00". */
function time(v: string): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(v.trim());
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

/** «Елена Ивановна» → «Е. И.» */
function initials(first: string): string {
  return first
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + '.')
    .join(' ');
}

const ones = (mask: string) =>
  [...mask].reduce<number[]>((acc, c, i) => (c === '1' ? [...acc, i] : acc), []);

export function parseAscXml(text: string, file = ''): Schedule {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Файл не читается как XML. Нужна выгрузка aSc в формате XML.');
  }
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'timetable') {
    throw new Error(
      'В файле нет расписания aSc: ожидался XML-экспорт aSc (корневой элемент <timetable>).',
    );
  }
  const els = (tag: string) => Array.from(root.getElementsByTagName(tag));
  const a = (el: Element, name: string) => (el.getAttribute(name) ?? '').trim();
  const warnings: string[] = [];

  // Звонки и номера уроков
  const periodToLesson = new Map<string, number>();
  const bells: Bell[] = els('period')
    .map((p, i) => {
      const key = a(p, 'period') || a(p, 'name') || String(i + 1);
      const num = Number.parseInt(key, 10);
      const lesson = Number.isNaN(num) ? i + 1 : num;
      periodToLesson.set(key, lesson);
      return {
        lesson,
        label: a(p, 'short') || a(p, 'name') || String(lesson),
        start: time(a(p, 'starttime')),
        end: time(a(p, 'endtime')),
      };
    })
    .sort((x, y) => x.lesson - y.lesson);
  const order = bells.map((b) => b.lesson);
  const lessonOf = (period: string) => periodToLesson.get(period) ?? Number.parseInt(period, 10);
  /** Урок, идущий через `k` после `start` (для сдвоенных уроков); `null` — за последним звонком. */
  const shift = (start: number, k: number): number | null => {
    if (!order.length) return start + k;
    const i = order.indexOf(start);
    return i >= 0 && i + k < order.length ? order[i + k] : null;
  };
  let overflow = 0;

  // Дни
  let dayCount = 0;
  const dayNames = new Map<number, { name: string; short: string }>();
  for (const d of els('daysdef')) {
    const masks = ids(a(d, 'days'));
    for (const m of masks) dayCount = Math.max(dayCount, m.length);
    if (masks.length === 1 && ones(masks[0]).length === 1) {
      const n = ones(masks[0])[0] + 1;
      if (!dayNames.has(n)) dayNames.set(n, { name: a(d, 'name'), short: a(d, 'short') });
    }
  }
  const cards = els('card');
  for (const c of cards) dayCount = Math.max(dayCount, a(c, 'days').length);
  if (!dayCount) dayCount = 5;
  const days: Day[] = Array.from({ length: Math.min(dayCount, 7) }, (_, i) => {
    const n = i + 1;
    const own = dayNames.get(n);
    return { n, name: own?.name || RU_DAYS[i], short: own?.short || RU_DAYS_SHORT[i] };
  });

  // Справочники
  const subjects = els('subject').map((s) => ({
    id: a(s, 'id'),
    name: a(s, 'name') || a(s, 'short'),
    short: a(s, 'short') || a(s, 'name'),
  }));
  const teachers = els('teacher').map((t) => {
    const last = a(t, 'lastname');
    const ini = initials(a(t, 'firstname'));
    const name = last
      ? ini
        ? `${last} ${ini}`
        : last
      : a(t, 'name') || a(t, 'short') || a(t, 'id');
    const short = a(t, 'short') || name;
    // Соглашение завуча: краткое имя «мат Шпаченко» — приставка предмета и фамилия.
    const m = /^(\p{Ll}[\p{L}.]*)\s+(\S.*)$/u.exec(short);
    const tag =
      m && (!last || m[2].toLowerCase().startsWith(last.slice(0, 4).toLowerCase()))
        ? m[1]
        : undefined;
    return { id: a(t, 'id'), name, short, ...(tag ? { tag } : {}) };
  });
  const rooms = els('classroom').map((r) => ({
    id: a(r, 'id'),
    name: a(r, 'name') || a(r, 'short'),
    short: a(r, 'short') || a(r, 'name'),
  }));
  const classes: SchoolClass[] = els('class').map((c) => {
    const g = Number.parseInt(a(c, 'grade'), 10);
    return {
      id: a(c, 'id'),
      name: a(c, 'short') || a(c, 'name'),
      grade: Number.isNaN(g) ? null : g,
      teacher: a(c, 'teacherid') || null,
    };
  });
  const groups = new Map(
    els('group').map((g) => [
      a(g, 'id'),
      { name: a(g, 'name'), whole: a(g, 'entireclass') === '1', division: a(g, 'divisiontag') },
    ]),
  );

  const perWeek = new Map(
    els('lesson').map((l) => [a(l, 'id'), Number.parseFloat(a(l, 'periodsperweek')) || undefined]),
  );
  type Lesson = {
    classes: string[];
    groups: string[];
    subject: string | null;
    teachers: string[];
    rooms: string[];
    perCard: number;
  };
  const lessons = new Map<string, Lesson>(
    els('lesson').map((l) => [
      a(l, 'id'),
      {
        classes: ids(a(l, 'classids')),
        groups: ids(a(l, 'groupids')),
        subject: a(l, 'subjectid') || null,
        teachers: ids(a(l, 'teacherids')),
        rooms: ids(a(l, 'classroomids')),
        perCard: Math.max(1, Number.parseInt(a(l, 'periodspercard'), 10) || 1),
      },
    ]),
  );

  // Карточки → уроки в клетках
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const placed = new Set<string>();
  let orphanCards = 0;
  const notes: ParseNotes = {
    overflow: [],
    unplaced: [],
    partial: [],
    orphanCards: 0,
    cards: cards.length,
    synthesized: 0,
  };
  // Сдвоенный урок aSc 2027 выгружает карточкой на КАЖДЫЙ урок пары (1 и 2), старые версии —
  // одной карточкой на первый урок. Достраиваем пару только если карточек меньше, чем уроков подряд.
  const cardsPerLessonDay = new Map<string, number>();
  for (const c of cards)
    for (const d of ones(a(c, 'days'))) {
      const k = `${a(c, 'lessonid')}|${d}|${a(c, 'weeks')}`;
      cardsPerLessonDay.set(k, (cardsPerLessonDay.get(k) ?? 0) + 1);
    }
  for (const c of cards) {
    const lessonId = a(c, 'lessonid');
    const l = lessons.get(lessonId);
    if (!l) {
      orphanCards++;
      continue;
    }
    placed.add(lessonId);
    const start = lessonOf(a(c, 'period'));
    if (Number.isNaN(start)) continue;
    const cardRooms = ids(a(c, 'classroomids'));
    const roomIds = cardRooms.length ? cardRooms : l.rooms.length === 1 ? l.rooms : [];
    const gs = l.groups.map((g) => groups.get(g)).filter((g) => g != null);
    const whole = !gs.length || gs.some((g) => g.whole);
    const group = whole ? null : [...new Set(gs.map((g) => g.name))].join(', ') || null;
    const division = whole ? null : [...new Set(gs.map((g) => g.division))].join(',') || null;
    // Маски «1» / «11» — каждую неделю / весь год; «10», «01» — только часть.
    const weeksMask = a(c, 'weeks');
    const weeks = weeksMask && weeksMask.includes('0') ? weeksMask : null;
    const termsMask = a(c, 'terms');
    const terms = termsMask && termsMask.includes('0') ? termsMask : null;
    for (const d of ones(a(c, 'days'))) {
      const already = cardsPerLessonDay.get(`${lessonId}|${d}|${weeksMask}`) ?? 1;
      const span = already >= l.perCard ? 1 : l.perCard;
      if (span > 1) notes.synthesized += span - 1;
      for (let k = 0; k < span; k++) {
        const lesson = shift(start, k);
        if (lesson == null) {
          overflow++;
          notes.overflow.push({
            classes: l.classes,
            subject: l.subject,
            teachers: l.teachers,
            day: d + 1,
            lesson: start,
          });
          continue;
        }
        const e: Entry = {
          day: d + 1,
          lesson,
          classes: l.classes,
          group,
          subject: l.subject,
          teachers: l.teachers,
          rooms: roomIds,
          weeks,
          ...(terms ? { terms } : {}),
          ...(division ? { division } : {}),
        };
        const key = `${lessonId}|${e.day}|${e.lesson}|${weeks}|${terms}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push(e);
      }
    }
  }
  entries.sort((x, y) => x.day - y.day || x.lesson - y.lesson);

  // Сколько уроков каждой нагрузки реально стоит в сетке за неделю (с учётом пар).
  const placedCount = new Map<string, number>();
  for (const c of cards) {
    const id = a(c, 'lessonid');
    const l = lessons.get(id);
    if (!l) continue;
    for (const d of ones(a(c, 'days'))) {
      const already = cardsPerLessonDay.get(`${id}|${d}|${a(c, 'weeks')}`) ?? 1;
      placedCount.set(id, (placedCount.get(id) ?? 0) + (already >= l.perCard ? 1 : l.perCard));
    }
  }
  for (const [id, l] of lessons) {
    const want = perWeek.get(id);
    const have = placedCount.get(id) ?? 0;
    if (!placed.has(id))
      notes.unplaced.push({
        classes: l.classes,
        subject: l.subject,
        teachers: l.teachers,
        perWeek: want,
      });
    // Дробная нагрузка (0.5 — раз в две недели) сравнивается только при одной неделе в расписании.
    else if (want != null && Number.isInteger(want) && have !== want)
      notes.partial.push({
        classes: l.classes,
        subject: l.subject,
        teachers: l.teachers,
        perWeek: want,
        placed: have,
      });
  }
  notes.orphanCards = orphanCards;
  const unplaced = notes.unplaced.length;
  if (unplaced)
    warnings.push(
      `${unplaced} записей нагрузки не поставлены в расписание — их нет ни в одной клетке.`,
    );
  if (overflow)
    warnings.push(
      `${overflow} сдвоенных уроков стоят на последнем уроке дня — вторая половина не показана.`,
    );
  if (orphanCards)
    warnings.push(`${orphanCards} карточек ссылаются на несуществующие уроки — пропущены.`);
  const noRoom = entries.filter((e) => !e.rooms.length).length;
  if (noRoom) warnings.push(`У ${noRoom} уроков не указан кабинет.`);
  const noTeacher = entries.filter((e) => !e.teachers.length).length;
  if (noTeacher) warnings.push(`У ${noTeacher} уроков не указан учитель.`);
  if (!bells.some((b) => b.start))
    warnings.push('В выгрузке нет времени звонков — в тексте для чатов время не будет указано.');

  return {
    format: FORMAT,
    source: { app: 'aSc', file },
    importedAt: new Date().toISOString(),
    days,
    bells,
    subjects,
    teachers,
    rooms,
    classes,
    entries,
    warnings,
    notes,
  };
}
