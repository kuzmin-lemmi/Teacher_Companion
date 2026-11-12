import { forwardRef, Fragment } from 'react';
import type { Change } from '../../src/school/diff';
import { lookup, type Schedule } from '../../src/school/model';
import { roomLabel, type ChatLine } from '../../src/school/text';
import {
  lessonColumns,
  primaryTeachers,
  teacherRowsIn,
  type TeacherScope,
} from '../../src/school/views';

export type Orient = 'portrait' | 'landscape';
export const PAGE = { portrait: { w: 194, h: 281 }, landscape: { w: 281, h: 194 } };
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export type SheetProps = { s: Schedule; day: number; title: string; date: string; orient: Orient };

export function Head({ title, date, note }: { title: string; date: string; note?: string }) {
  return (
    <header className="sheet-head">
      <div>
        <div className="sheet-title">{title}</div>
        {note && <div className="sheet-note">{note}</div>}
      </div>
      <div className="sheet-date">{date}</div>
    </header>
  );
}

/** Учителя × уроки: класс и кабинет — как бланк в учительской. */
export const TeacherSheet = forwardRef<
  HTMLDivElement,
  SheetProps & { changed: Set<string>; scope: TeacherScope }
>(function TeacherSheet({ s, day, title, date, orient, changed, scope }, ref) {
  const prim = primaryTeachers(s);
  // «Все вместе»: сначала предметники, потом отдельным блоком начальная школа.
  const all = teacherRowsIn(s, day, scope);
  const rows =
    scope === 'all'
      ? [
          ...all.filter((r) => !prim.has(r.teacher.id)),
          ...all.filter((r) => prim.has(r.teacher.id)),
        ]
      : all;
  const firstPrimary = scope === 'all' ? rows.findIndex((r) => prim.has(r.teacher.id)) : -1;
  const cols = lessonColumns(s);
  const L = lookup(s);
  const { w, h } = PAGE[orient];
  const row = clamp((h - 24) / (rows.length + 2 + (firstPrimary > 0 ? 1 : 0)), 4.3, 9);
  const fs = clamp(row * 0.58, 2.7, 4.2);
  return (
    <div className="sheet" ref={ref} style={{ width: `${w}mm`, minHeight: `${h}mm` }}>
      <Head
        title={title}
        date={date}
        note={changed.size ? 'Жёлтым — изменения относительно основного расписания' : undefined}
      />
      <table
        className="grid tgrid"
        style={{ fontSize: `${fs}mm`, ['--row' as string]: `${row}mm` }}
      >
        <colgroup>
          <col style={{ width: '5mm' }} />
          <col style={{ width: orient === 'portrait' ? '40mm' : '52mm' }} />
          {cols.map((n) => (
            <Fragment key={n}>
              <col />
              <col />
            </Fragment>
          ))}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2}>#</th>
            <th rowSpan={2} className="left">
              Учитель
            </th>
            {cols.map((n) => (
              <th key={n} colSpan={2} className="lesson-h">
                {L.bell(n)?.label ?? n}
                {L.bell(n)?.start && <span className="time">{L.bell(n)!.start}</span>}
              </th>
            ))}
          </tr>
          <tr>
            {cols.map((n) => (
              <Fragment key={n}>
                <th className="sub">Класс</th>
                <th className="sub">Каб.</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={r.teacher.id}>
              {i === firstPrimary && i > 0 && (
                <tr className="section">
                  <td colSpan={2 + cols.length * 2}>Начальная школа</td>
                </tr>
              )}
              <tr>
                <td className="num">{i + 1}</td>
                <td className="left name">
                  <span className="pre">
                    {prim.has(r.teacher.id) && !r.teacher.tag ? 'нач' : r.subject}
                  </span>{' '}
                  {r.teacher.name}
                </td>
                {cols.map((n) => {
                  const c = r.cells.get(n);
                  const cls = changed.has(`${r.teacher.name}|${n}`) ? 'chg' : '';
                  return (
                    <Fragment key={n}>
                      <td className={`cl ${cls}`}>{c?.classes}</td>
                      <td className={`room ${cls}`}>{c?.rooms}</td>
                    </Fragment>
                  );
                })}
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
});

const KIND_CLASS: Record<Change['kind'], string> = {
  замена: 'k-sub',
  кабинет: 'k-room',
  отмена: 'k-off',
  'новый урок': 'k-new',
};

/** Лист замен: только то, что изменилось на этот день. */
export const ChangesSheet = forwardRef<
  HTMLDivElement,
  { s: Schedule; changes: Change[]; title: string; date: string; orient: Orient; baseNote: string }
>(function ChangesSheet({ s, changes, title, date, orient, baseNote }, ref) {
  const L = lookup(s);
  const { w } = PAGE[orient];
  const byClass = new Map<string, Change[]>();
  for (const c of changes) byClass.set(c.className, [...(byClass.get(c.className) ?? []), c]);
  const teachers = [...new Set(changes.flatMap((c) => c.teachers))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
  return (
    <div className="sheet changes" ref={ref} style={{ width: `${w}mm` }}>
      <Head title={title} date={date} note={baseNote} />
      {!changes.length ? (
        <p className="empty">Изменений нет — расписание на этот день совпадает с основным.</p>
      ) : (
        <>
          <table className="grid zgrid">
            <colgroup>
              <col style={{ width: '13mm' }} />
              <col style={{ width: '16mm' }} />
              <col style={{ width: '22mm' }} />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Класс</th>
                <th>Урок</th>
                <th>Что</th>
                <th className="left">Было</th>
                <th className="left">Стало</th>
              </tr>
            </thead>
            <tbody>
              {[...byClass].map(([cls, list]) =>
                list.map((c, i) => (
                  <tr key={`${cls}-${c.lesson}`} className={i === 0 ? 'first' : ''}>
                    {i === 0 && (
                      <td rowSpan={list.length} className="cls">
                        {cls}
                      </td>
                    )}
                    <td className="num">
                      {c.lesson}
                      {L.bell(c.lesson)?.start && (
                        <span className="time">{L.bell(c.lesson)!.start}</span>
                      )}
                    </td>
                    <td>
                      <span className={`kind ${KIND_CLASS[c.kind]}`}>{c.kind}</span>
                    </td>
                    <td className="left was">
                      {c.before.length ? c.before.map((b) => <div key={b}>{b}</div>) : '—'}
                    </td>
                    <td className="left now">
                      {c.after.length ? c.after.map((b) => <div key={b}>{b}</div>) : 'урока нет'}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <p className="who-list">
            <b>Кого касается:</b> {teachers.join(', ')}
          </p>
        </>
      )}
    </div>
  );
});

/** Карточка класса для чата: крупно, читается с телефона. */
export const ChatCard = forwardRef<
  HTMLDivElement,
  {
    cls: string;
    date: string;
    lines: ChatLine[];
    changed: Set<number>;
    rooms: boolean;
    school: string;
  }
>(function ChatCard({ cls, date, lines, changed, rooms, school }, ref) {
  const end = lines.at(-1)?.end;
  return (
    <div className="chat-card" ref={ref}>
      <div className="cc-head">
        <div className="cc-class">{cls}</div>
        <div className="cc-date">{date}</div>
      </div>
      {!lines.length ? (
        <div className="cc-empty">Уроков нет</div>
      ) : (
        <ol className="cc-list">
          {lines.map((l) => (
            <li key={l.lesson} className={changed.has(l.lesson) ? 'chg' : ''}>
              <span className="cc-n">{l.lesson}</span>
              <span className="cc-time">{l.start && `${l.start}–${l.end}`}</span>
              <span className="cc-subj">
                {l.title}
                {changed.has(l.lesson) && <span className="cc-badge">изменение</span>}
              </span>
              {rooms && <span className="cc-room">{l.rooms && roomLabel(l.rooms)}</span>}
            </li>
          ))}
        </ol>
      )}
      <div className="cc-foot">
        {end ? (
          <span>
            🔔 Уроки заканчиваются в <b>{end}</b>
          </span>
        ) : (
          <span />
        )}
        <span className="cc-school">{school}</span>
      </div>
    </div>
  );
});
