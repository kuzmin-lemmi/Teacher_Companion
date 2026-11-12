/** Бланки для учеников: классы слева, уроки сверху. */
import { forwardRef, Fragment } from 'react';
import { classSortKey, lookup, type Schedule } from '../../src/school/model';
import { classItemsAt, lessonColumns, sortedClasses, type ClassItem } from '../../src/school/views';
import { clamp, Head, PAGE, type Orient, type SheetProps } from './Sheets';

/**
 * split   — как бланк учителей: у каждого урока две колонки «Предмет | Каб.»;
 * compact — одна клетка на урок: «Мат 20»;
 * week    — вся неделя: дни сверху, в клетке уроки по порядку.
 */
export type ClassLayout = 'split' | 'compact' | 'week';
/** 'all', '5-11' … или одна параллель: 'g7'. */
export type GradeRange = string;
export const GRADE_RANGES: { id: GradeRange; label: string; lo: number; hi: number }[] = [
  { id: 'all', label: 'все классы', lo: 0, hi: 99 },
  { id: '1-4', label: '1–4 классы', lo: 1, hi: 4 },
  { id: '5-11', label: '5–11 классы', lo: 5, hi: 11 },
  { id: '5-9', label: '5–9 классы', lo: 5, hi: 9 },
  { id: '10-11', label: '10–11 классы', lo: 10, hi: 11 },
  ...Array.from({ length: 11 }, (_, i) => ({
    id: `g${i + 1}`,
    label: `${i + 1}-е классы`,
    lo: i + 1,
    hi: i + 1,
  })),
];

type Cell = { subject: string; rooms: string; teachers: string };

/** Группы с одним предметом — одной строкой: «Англ.яз», каб. «31/41». */
function collapse(items: ClassItem[], full = false): Cell[] {
  const by = new Map<string, ClassItem[]>();
  for (const it of items) {
    const k = full ? it.subject : it.short;
    by.set(k, [...(by.get(k) ?? []), it]);
  }
  return [...by].map(([subject, list]) => ({
    subject,
    rooms: [...new Set(list.map((i) => i.rooms).filter(Boolean))].join('/'),
    teachers: [...new Set(list.map((i) => i.teachers).filter(Boolean))].join(', '),
  }));
}

function classesIn(s: Schedule, range: GradeRange) {
  const r = GRADE_RANGES.find((g) => g.id === range) ?? GRADE_RANGES[0];
  return sortedClasses(s).filter((c) => {
    const g = classSortKey(c.name, c.grade)[0];
    return g >= r.lo && g <= r.hi;
  });
}

export type ClassSheetProps = SheetProps & {
  changed: Set<string>;
  showTeachers: boolean;
  fullNames: boolean;
  layout: ClassLayout;
  range: GradeRange;
};

/**
 * Подбор шрифта, чтобы лист влез на страницу. Полные названия переносятся на 2–3 строки,
 * поэтому считаем строки в каждой клетке по ширине колонки.
 */
function fitRows(
  rows: { cells: Map<number, Cell[]> }[],
  o: { w: number; h: number; cols: number; split: boolean; orient: Orient; showTeachers: boolean },
) {
  const roomW = o.split ? (o.orient === 'portrait' ? 8 : 11) : 0;
  const subjW = (o.w - 15) / Math.max(1, o.cols) - roomW - 1.2;
  const avail = o.h - 26;
  let fs = 4.4;
  let heights: number[] = [];
  for (; fs >= 2.3; fs -= 0.1) {
    const perLine = Math.max(4, Math.floor(subjW / (fs * 0.56)));
    const lineH = fs * 1.2;
    heights = rows.map((r) => {
      let maxLines = 1;
      for (const items of r.cells.values()) {
        let n = 0;
        for (const it of items) {
          const text = o.split ? it.subject : `${it.subject} ${it.rooms}`;
          n +=
            Math.ceil(text.length / perLine) +
            (o.showTeachers && it.teachers ? Math.ceil(it.teachers.length / (perLine * 1.2)) : 0);
        }
        maxLines = Math.max(maxLines, n);
      }
      return maxLines * lineH + 1;
    });
    const header = fs * (o.split ? 4.2 : 3);
    if (heights.reduce((a, b) => a + b, 0) + header <= avail) break;
  }
  // Если место осталось — растягиваем строки, чтобы лист был заполнен ровно.
  const header = fs * (o.split ? 4.2 : 3);
  const sum = heights.reduce((a, b) => a + b, 0);
  const stretch = sum > 0 ? Math.min(1.6, Math.max(1, (avail - header) / sum)) : 1;
  return { fs: Math.max(fs, 2.3), heights: heights.map((x) => x * stretch) };
}

export const ClassSheet = forwardRef<HTMLDivElement, ClassSheetProps>(
  function ClassSheet(props, ref) {
    return props.layout === 'week' ? (
      <ClassWeekSheet {...props} ref={ref} />
    ) : (
      <ClassDaySheet {...props} ref={ref} />
    );
  },
);

const ClassDaySheet = forwardRef<HTMLDivElement, ClassSheetProps>(function ClassDaySheet(
  { s, day, title, date, orient, changed, showTeachers, fullNames, layout, range },
  ref,
) {
  const L = lookup(s);
  const cols = lessonColumns(s);
  const { w, h } = PAGE[orient];
  const rows = classesIn(s, range).map((cls) => ({
    cls,
    cells: new Map(
      [...classItemsAt(s, cls.id, day)].map(([n, it]) => [n, collapse(it, fullNames)]),
    ),
  }));
  const split = layout === 'split';
  const { fs, heights } = fitRows(rows, { w, h, cols: cols.length, split, orient, showTeachers });
  const bell = (n: number) => L.bell(n);
  return (
    <div className="sheet" ref={ref} style={{ width: `${w}mm`, minHeight: `${h}mm` }}>
      <Head
        title={title}
        date={date}
        note={changed.size ? 'Жёлтым — изменения относительно основного расписания' : undefined}
      />
      <table
        className={`grid cgrid ${split ? 'split' : 'compact'}`}
        style={{ fontSize: `${fs}mm` }}
      >
        <colgroup>
          <col style={{ width: '5mm' }} />
          <col style={{ width: '10mm' }} />
          {cols.map((n) =>
            split ? (
              <Fragment key={n}>
                <col />
                <col style={{ width: orient === 'portrait' ? '8mm' : '11mm' }} />
              </Fragment>
            ) : (
              <col key={n} />
            ),
          )}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={split ? 2 : 1}>#</th>
            <th rowSpan={split ? 2 : 1}>Класс</th>
            {cols.map((n) => (
              <th key={n} colSpan={split ? 2 : 1} className="lesson-h">
                {bell(n)?.label ?? n}
                {bell(n)?.start && (
                  <span className="time">
                    {bell(n)!.start}–{bell(n)!.end}
                  </span>
                )}
              </th>
            ))}
          </tr>
          {split && (
            <tr>
              {cols.map((n) => (
                <Fragment key={n}>
                  <th className="sub">Предмет</th>
                  <th className="sub">Каб.</th>
                </Fragment>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.cls.id} style={{ height: `${heights[i]}mm` }}>
              <td className="num">{i + 1}</td>
              <td className="cls">{r.cls.name}</td>
              {cols.map((n) => {
                const items = r.cells.get(n) ?? [];
                const chg = changed.has(`${r.cls.name}|${n}`) ? 'chg' : '';
                if (!split)
                  return (
                    <td key={n} className={chg}>
                      {items.map((it, k) => (
                        <div className="item" key={k}>
                          <b>{it.subject}</b>
                          {it.rooms && <span className="room"> {it.rooms}</span>}
                          {showTeachers && it.teachers && <div className="who">{it.teachers}</div>}
                        </div>
                      ))}
                    </td>
                  );
                return (
                  <Fragment key={n}>
                    <td className={`subj ${chg}`}>
                      {items.map((it, k) => (
                        <div className="item" key={k}>
                          {it.subject}
                          {showTeachers && it.teachers && <div className="who">{it.teachers}</div>}
                        </div>
                      ))}
                    </td>
                    <td className={`room ${chg}`}>
                      {items.map((it, k) => (
                        <div className={`item ${it.rooms.length > 5 ? 'tight' : ''}`} key={k}>
                          {it.rooms || ' '}
                          {showTeachers && it.teachers && <div className="who">{' '}</div>}
                        </div>
                      ))}
                    </td>
                  </Fragment>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

/** Неделя: дни сверху, классы слева, в клетке — уроки дня по порядку. */
const ClassWeekSheet = forwardRef<HTMLDivElement, ClassSheetProps>(function ClassWeekSheet(
  { s, title, orient, range, fullNames },
  ref,
) {
  const classes = classesIn(s, range);
  const cols = lessonColumns(s);
  const { w, h } = PAGE[orient];
  const maxLessons = Math.max(
    1,
    ...classes.flatMap((c) => s.days.map((d) => classItemsAt(s, c.id, d.n).size)),
  );
  const row = (h - 24) / (classes.length + 0.6);
  const fs = clamp((row / (maxLessons + 0.4)) * 0.78, 1.8, 4.6);
  return (
    <div className="sheet" ref={ref} style={{ width: `${w}mm`, minHeight: `${h}mm` }}>
      <Head
        title={title}
        date={`На неделю · ${(GRADE_RANGES.find((g) => g.id === range) ?? GRADE_RANGES[0]).label}`}
      />
      {classes.length > 6 && (
        <div className="sheet-note no-print">
          Для недели лучше выбрать одну параллель — иначе шрифт станет слишком мелким.
        </div>
      )}
      <table className="grid wgrid" style={{ fontSize: `${fs}mm` }}>
        <colgroup>
          <col style={{ width: '10mm' }} />
          {s.days.map((d) => (
            <col key={d.n} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>Класс</th>
            {s.days.map((d) => (
              <th key={d.n} className="lesson-h">
                {d.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {classes.map((c) => (
            <tr key={c.id}>
              <td className="cls">{c.name}</td>
              {s.days.map((d) => {
                const cells = classItemsAt(s, c.id, d.n);
                return (
                  <td key={d.n} className="wcell">
                    {cols
                      .filter((n) => cells.has(n))
                      .map((n) => (
                        <div key={n} className="wl">
                          <span className="wn">{n}</span>
                          <span className="ws">
                            {collapse(cells.get(n)!, fullNames)
                              .map((x) => x.subject)
                              .join(' / ')}
                          </span>
                          <span className="wr">
                            {collapse(cells.get(n)!, fullNames)
                              .map((x) => x.rooms)
                              .filter(Boolean)
                              .join(' / ')}
                          </span>
                        </div>
                      ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});
