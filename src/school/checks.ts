/**
 * Проверка расписания перед печатью: что завуч мог случайно сделать в aSc
 * и как это исправить. Каждая проблема — с конкретными классами, днями и уроками.
 */
import {
  compareClasses,
  lookup,
  overlapsInTime,
  plural,
  type Entry,
  type Id,
  type LessonNote,
  type Schedule,
} from './model';

export type Level = 'error' | 'warn' | 'info';
export type Issue = {
  id: string;
  level: Level;
  title: string;
  /** Что увидят люди на бланке, если не исправить. */
  why: string;
  /** Где это исправить в aSc. */
  fix: string;
  items: string[];
  /** Для опечаток: «как в aSc» → «как, похоже, должно быть». */
  renames?: { from: string; to: string }[];
};

const LEVEL_ORDER: Record<Level, number> = { error: 0, warn: 1, info: 2 };

export function checkSchedule(s: Schedule): Issue[] {
  const L = lookup(s);
  const day = (n: number) => s.days.find((d) => d.n === n)?.name.toLowerCase() ?? `день ${n}`;
  const slot = (d: number, n: number) => `${day(d)}, ${n} урок`;
  const subj = (id: Id | null) => L.subject(id)?.name ?? 'без предмета';
  const teachers = (ids: Id[]) =>
    ids.map((t) => L.teacher(t)?.name ?? t).join(', ') || 'без учителя';
  const classes = (ids: Id[]) => ids.map((c) => L.cls(c)?.name ?? c).join(', ') || 'без класса';
  const lessonText = (
    e: Pick<Entry, 'classes' | 'subject' | 'teachers'> & { group?: string | null },
  ) =>
    `${classes(e.classes)}${e.group ? ` (${e.group})` : ''} — ${subj(e.subject)} (${teachers(e.teachers)})`;
  const issues: Issue[] = [];
  const add = (i: Issue) => i.items.length && issues.push(i);

  /** Уроки из списка, у которых есть «конфликтная» пара: идут в одно время и `bad(x, y)`. */
  const clashing = (list: Entry[], bad: (x: Entry, y: Entry) => boolean) => {
    const hit = new Set<Entry>();
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (overlapsInTime(list[i], list[j]) && bad(list[i], list[j])) {
          hit.add(list[i]);
          hit.add(list[j]);
        }
    return [...hit];
  };
  /** «10» → «неделя 1 из 2»; «0101» → «недели 2, 4 из 4». */
  const part = (mask: string, one: string, many: string) => {
    const on = [...mask].flatMap((c, i) => (c === '1' ? [i + 1] : []));
    return `${on.length === 1 ? one : many} ${on.join(', ')} из ${mask.length}`;
  };
  const weeksNote = (e: Entry) =>
    (e.weeks ? ` [${part(e.weeks, 'неделя', 'недели')}]` : '') +
    (e.terms ? ` [${part(e.terms, 'часть года', 'части года')}]` : '');

  // 1. Учитель в двух местах сразу.
  // Один предмет у групп разных классов («девочки 7Б и 7В вместе») — сборная группа, не накладка.
  const byTeacher = group(
    s.entries.flatMap((e) => e.teachers.map((t) => [`${t}|${e.day}|${e.lesson}`, e] as const)),
  );
  const teacherClash: string[] = [];
  for (const [k, list] of byTeacher) {
    if (list.length < 2) continue;
    const bad = clashing(
      list,
      (x, y) =>
        x.subject !== y.subject || (!x.group && !y.group && x.classes.join() !== y.classes.join()),
    );
    if (!bad.length) continue;
    const [t, d, n] = k.split('|');
    teacherClash.push(
      `${L.teacher(t)?.name ?? t}: ${slot(+d, +n)} — ${bad.map((e) => `${classes(e.classes)}${e.group ? ` (${e.group})` : ''} ${subj(e.subject)}${weeksNote(e)}`).join(' и ')}`,
    );
  }
  add({
    id: 'teacher-clash',
    level: 'error',
    title: 'Учитель стоит на двух уроках одновременно',
    why: 'На бланке учителей в клетке окажутся два класса, а один из классов останется без учителя.',
    fix: 'В aSc перетащите одну из карточек на другой урок или замените учителя.',
    items: teacherClash,
  });

  // 2. У класса два урока сразу. Можно: разные группы одного деления («1 группа» и «2 группа»).
  // Нельзя: урок всему классу и ещё что-то; одна и та же группа дважды; группы разных делений
  // («1 группа» и «Мальчики») — в них одни и те же ученики.
  const byClass = group(
    s.entries.flatMap((e) => e.classes.map((c) => [`${c}|${e.day}|${e.lesson}`, e] as const)),
  );
  const classClash: string[] = [];
  for (const [k, list] of byClass) {
    if (list.length < 2) continue;
    const bad = clashing(
      list,
      (x, y) =>
        !x.group || !y.group || x.group === y.group || (x.division ?? '') !== (y.division ?? ''),
    );
    if (!bad.length) continue;
    const [c, d, n] = k.split('|');
    classClash.push(
      `${L.cls(c)?.name ?? c}: ${slot(+d, +n)} — ${bad.map((e) => `${subj(e.subject)} (${e.group ?? 'весь класс'}, ${teachers(e.teachers)})${weeksNote(e)}`).join(' и ')}`,
    );
  }
  add({
    id: 'class-clash',
    level: 'error',
    title: 'У класса два урока одновременно',
    why: 'Ученики увидят в одной клетке два предмета и не поймут, куда идти.',
    fix: 'Если это деление на группы — в aSc укажите у обоих уроков группы одного деления (Спецификация → Уроки → группа). Если нет — передвиньте одну карточку.',
    items: classClash,
  });

  // 3. Два разных урока в одном кабинете
  const isHall = (name: string) => /спорт|с\/з|б\/с|м\/с|акт/i.test(name);
  const byRoom = group(
    s.entries.flatMap((e) => e.rooms.map((r) => [`${r}|${e.day}|${e.lesson}`, e] as const)),
  );
  const roomClash: string[] = [];
  for (const [k, list] of byRoom) {
    if (list.length < 2 || isHall(L.room(k.split('|')[0])?.name ?? '')) continue;
    const bad = clashing(list, (x, y) => x.teachers.join() !== y.teachers.join());
    if (!bad.length) continue;
    const [r, d, n] = k.split('|');
    roomClash.push(
      `каб. ${L.room(r)?.short ?? r}: ${slot(+d, +n)} — ${bad.map((e) => lessonText(e) + weeksNote(e)).join('; ')}`,
    );
  }
  add({
    id: 'room-clash',
    level: 'warn',
    title: 'В одном кабинете два урока одновременно',
    why: 'Два класса придут в один кабинет.',
    fix: 'В aSc откройте карточку урока и выберите другой кабинет. Спортзалы и актовый зал не проверяются — там бывает несколько классов.',
    items: roomClash,
  });

  // 3а. Поставлено не столько уроков, сколько часов в нагрузке
  add({
    id: 'partial',
    level: 'warn',
    title: 'Поставлено не столько уроков, сколько часов в нагрузке',
    why: 'У класса будет меньше (или больше) уроков предмета, чем положено по учебному плану.',
    fix: 'В aSc у таких уроков остались неразмещённые карточки (внизу экрана) — поставьте их в сетку. Если часов стало меньше — исправьте «уроков в неделю» в Спецификация → Уроки.',
    items: (s.notes?.partial ?? []).map(
      (n) => `${lessonText(n)}: по нагрузке ${n.perWeek} ч. в неделю, поставлено ${n.placed}`,
    ),
  });

  // 3б. Уроки не каждую неделю / не весь год — бланк на день показывает их все
  add({
    id: 'weeks',
    level: 'info',
    title: 'Уроки не каждую неделю или не весь год',
    why: 'Бланк на день показывает такие уроки всегда — проверьте, что печатаете для нужной недели.',
    fix: 'Ничего исправлять не нужно, если так задумано.',
    items: s.entries
      .filter((e) => e.weeks || e.terms)
      .map((e) => `${lessonText(e)}: ${slot(e.day, e.lesson)}${weeksNote(e)}`),
  });

  // 4. Сдвоенный урок за последним звонком
  add({
    id: 'overflow',
    level: 'error',
    title: 'Сдвоенный урок стоит последним — вторая половина выпадает',
    why: 'Урок двойной, но после него в сетке звонков уроков больше нет. На бланке показан только первый урок.',
    fix: 'В aSc передвиньте карточку на урок раньше или сделайте урок одинарным (Спецификация → Уроки → «уроков подряд» = 1).',
    items: (s.notes?.overflow ?? []).map((n) => `${lessonText(n)}: ${slot(n.day!, n.lesson!)}`),
  });

  // 5. Нагрузка не поставлена
  add({
    id: 'unplaced',
    level: 'warn',
    title: 'Уроки есть в нагрузке, но не поставлены в расписание',
    why: 'Их нет ни на одном бланке — будто урока не существует.',
    fix: 'В aSc эти карточки лежат внизу, в «неразмещённых». Поставьте их в сетку или удалите урок из нагрузки, если он не нужен.',
    items: (s.notes?.unplaced ?? []).map(
      (n: LessonNote) => `${lessonText(n)}${n.perWeek ? `, ${n.perWeek} ч. в неделю` : ''}`,
    ),
  });

  // 6. Без кабинета — сгруппировано по учителю
  const noRoom = group(
    s.entries.filter((e) => !e.rooms.length).map((e) => [e.teachers.join(',') || '-', e] as const),
  );
  add({
    id: 'no-room',
    level: 'warn',
    title: 'Не указан кабинет',
    why: 'В колонке «Каб.» будет пусто — ученики не узнают, куда идти.',
    fix: 'В aSc откройте карточку урока и назначьте кабинет. Чтобы не делать это каждый раз — задайте кабинет урока в нагрузке (Спецификация → Уроки → кабинет).',
    items: [...noRoom]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([t, list]) => {
        const who = t === '-' ? 'без учителя' : teachers(t.split(','));
        const cls = [
          ...new Set(list.flatMap((e) => e.classes.map((c) => L.cls(c)?.name ?? c))),
        ].join(', ');
        return `${who}: ${list.length} ${plural(list.length, 'урок', 'урока', 'уроков')} (${cls})`;
      }),
  });

  // 7. Без учителя
  add({
    id: 'no-teacher',
    level: 'warn',
    title: 'У урока не указан учитель',
    why: 'Урок не попадёт на бланк учителей и в Teacher Companion.',
    fix: 'В aSc: Спецификация → Уроки → укажите учителя.',
    items: s.entries
      .filter((e) => !e.teachers.length)
      .map((e) => `${classes(e.classes)} — ${subj(e.subject)}: ${slot(e.day, e.lesson)}`),
  });

  // 8. Опечатки в названиях предметов и кабинетов
  const renames = [...s.subjects.flatMap((x) => [x.name, x.short]), ...s.rooms.map((r) => r.name)]
    .map((from) => ({ from, to: fixTypos(from) }))
    .filter((r, i, all) => r.to !== r.from && all.findIndex((x) => x.from === r.from) === i);
  if (renames.length)
    issues.push({
      id: 'typos',
      level: 'warn',
      title: 'Похоже на опечатки в названиях',
      why: 'Названия печатаются на бланках и уходят в чаты родителям как есть.',
      fix: 'Исправьте в aSc (Спецификация → Предметы или Кабинеты). Или нажмите «Исправить для бланков» — aSc не изменится, исправленные названия будут только здесь.',
      items: renames.map((r) => `«${r.from}» → «${r.to}»`),
      renames,
    });

  // 9. Окна у классов
  const gaps: string[] = [];
  for (const c of [...s.classes].sort(compareClasses)) {
    for (const d of s.days) {
      const nums = [
        ...new Set(
          s.entries.filter((e) => e.day === d.n && e.classes.includes(c.id)).map((e) => e.lesson),
        ),
      ].sort((a, b) => a - b);
      const holes = nums.length
        ? range(nums[0], nums[nums.length - 1]).filter((n) => !nums.includes(n))
        : [];
      if (holes.length) gaps.push(`${c.name}: ${day(d.n)} — нет ${holes.join(', ')} урока`);
    }
  }
  add({
    id: 'gaps',
    level: 'info',
    title: 'Окна у классов',
    why: 'Между уроками у класса пустой урок. Иногда так задумано, иногда урок забыли поставить.',
    fix: 'Если не задумано — в aSc поставьте урок в пустую клетку или сдвиньте следующие уроки.',
    items: gaps,
  });

  // 10. Классные руководители — понадобятся для Teacher Companion
  const used = new Set(s.entries.flatMap((e) => e.classes));
  add({
    id: 'no-homeroom',
    level: 'info',
    title: 'Не указан классный руководитель',
    why: 'Бланкам это не мешает. Но в Teacher Companion расписание класса для родителей увидит только классный руководитель.',
    fix: 'В aSc: Спецификация → Классы → класс → «Классный руководитель».',
    items: [...s.classes]
      .filter((c) => used.has(c.id) && !(c.teacher && L.teacher(c.teacher)))
      .sort(compareClasses)
      .map((c) => c.name),
  });

  if ((s.notes?.orphanCards ?? 0) > 0)
    issues.push({
      id: 'orphans',
      level: 'info',
      title: 'Битые карточки в файле',
      why: 'Карточки ссылаются на урок, которого нет в нагрузке. Они пропущены.',
      fix: 'Обычно помогает пересохранить расписание в aSc и сделать экспорт заново.',
      items: [`${s.notes!.orphanCards} шт.`],
    });
  if (!s.bells.some((b) => b.start))
    issues.push({
      id: 'no-bells',
      level: 'info',
      title: 'Нет времени звонков',
      why: 'На бланках и в тексте для чатов не будет времени уроков.',
      fix: 'В aSc: Спецификация → Звонки — укажите начало и конец каждого урока.',
      items: ['звонки не заданы'],
    });

  return issues.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

function group<K, V>(pairs: (readonly [K, V])[]): Map<K, V[]> {
  const m = new Map<K, V[]>();
  for (const [k, v] of pairs) m.set(k, [...(m.get(k) ?? []), v]);
  return m;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------- Опечатки ----------

/** Слова из названий школьных предметов и кабинетов — по ним ищем опечатки. */
const VOCAB =
  `русский язык литература литературное чтение родной родная математика алгебра геометрия вероятность и статистика
информатика физика химия биология география история обществознание английский немецкий французский китайский иностранный
физическая культура музыка изобразительное искусство труд технология технологии обзр окружающий мир орксэ однкнр
разговоры о важном россия мои горизонты индивидуальный проект экология астрономия право экономика черчение
программирование программирования основы основ геометрии избранные вопросы математики русское правописание
историческое краеведение научные химии в примерах и задачах саратовского поволжья днк россии семьеведение
финансовая грамотность функциональная грамотность психология риторика шахматы хореография
актовый зал конференц спортивный спорт большой малый мастерская библиотека кабинет лаборатория англ яз`
    .split(/\s+/)
    .filter(Boolean);
const VOCAB_SET = new Set(VOCAB);

/** Расстояние Дамерау–Левенштейна (перестановка двух букв — одна ошибка). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

function fixWord(w: string): string {
  const low = w.toLowerCase();
  // Аббревиатуры (ДНКР, ОБЗР) не трогаем
  if (low.length < 4 || w === w.toUpperCase() || VOCAB_SET.has(low) || !/^[а-яё]+$/.test(low))
    return w;
  const limit = low.length >= 8 ? 2 : 1;
  let best: string | null = null;
  let bestD = limit + 1;
  for (const v of VOCAB) {
    if (Math.abs(v.length - low.length) > limit) continue;
    const dd = distance(low, v);
    if (dd < bestD) {
      best = v;
      bestD = dd;
    }
  }
  if (!best) return w;
  return w[0] === w[0].toUpperCase() ? best[0].toUpperCase() + best.slice(1) : best;
}

/** «Алебра» → «Алгебра», «Анлг.яз» → «Англ.яз»; если всё в порядке — та же строка. */
export function fixTypos(text: string): string {
  return text.replace(/[А-Яа-яЁё]+/g, (w) => fixWord(w));
}
