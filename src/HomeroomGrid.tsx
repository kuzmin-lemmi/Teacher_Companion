import {
  lessonsForDay,
  sameClass,
  weekdays,
  type AppData,
  type ClassLesson,
  type Homeroom,
} from './domain';

const shortDay = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт'];
const noHomeroom: Homeroom = { enabled: false, className: '', lessons: [] };
const unique = (values: string[]) =>
  [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru', { numeric: true }),
  );

/**
 * Компьютер: расписание своего класса для классного руководителя — неделя таблицей,
 * в клетке предмет и кабинет. Свои уроки учителя в этом классе подставлены сами и здесь не правятся.
 */
export function HomeroomGrid({ data, change }: { data: AppData; change: (next: AppData) => void }) {
  const homeroom = data.homeroom ?? noHomeroom;
  const save = (patch: Partial<Homeroom>) =>
    change({ ...data, homeroom: { ...homeroom, ...patch } });
  const className = homeroom.className.trim();
  const mine = data.lessons.filter((l) => sameClass(l.className, homeroom.className));
  const last = Math.min(
    20,
    Math.max(
      6,
      ...data.bells.map((b) => b.lessonNumber),
      ...homeroom.lessons.map((l) => l.lessonNumber),
      ...mine.map((l) => l.lessonNumber),
    ),
  );
  const numbers = Array.from({ length: last }, (_, i) => i + 1);
  /** Ввод в клетку: пустая клетка с текстом становится уроком, урок без текста — пустой клеткой. */
  function set(weekday: number, lessonNumber: number, patch: Partial<ClassLesson>) {
    const found = homeroom.lessons.find(
      (l) => l.weekday === weekday && l.lessonNumber === lessonNumber,
    );
    const lesson: ClassLesson = {
      ...(found ?? {
        id: crypto.randomUUID(),
        weekday,
        lessonNumber,
        subject: '',
        room: '',
        teacher: '',
      }),
      ...patch,
    };
    const others = homeroom.lessons.filter((l) => l !== found);
    const empty = !lesson.subject.trim() && !lesson.room.trim() && !lesson.teacher.trim();
    save({ lessons: empty ? others : [...others, lesson] });
  }
  return (
    <>
      <section className="ed-card">
        <label className="pf-toggle">
          <div>
            <strong>Я классный руководитель</strong>
            <small>
              Неделю своего класса видно в виджете: «Неделя» → переключатель над таблицей.
            </small>
          </div>
          <input
            type="checkbox"
            checked={homeroom.enabled}
            onChange={(e) => save({ enabled: e.target.checked })}
          />
        </label>
        {homeroom.enabled && (
          <label className="hr-class">
            <span>Мой класс</span>
            <input
              value={homeroom.className}
              placeholder="Например, 7Б"
              maxLength={40}
              list="hr-classes"
              autoFocus={!className}
              onChange={(e) => save({ className: e.target.value })}
            />
            <datalist id="hr-classes">
              {unique(data.lessons.map((l) => l.className)).map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
        )}
      </section>
      {homeroom.enabled && className && (
        <section className="ed-card">
          <div className="ed-card-head">
            <div>
              <h2>Уроки {className}</h2>
              <p className="muted">
                Впишите предмет и, если нужно, кабинет. Время — по вашим звонкам. Ваши уроки в{' '}
                {className} подставлены сами — их меняют в «Расписании».
              </p>
            </div>
          </div>
          <table className="ed-week hr-week">
            <thead>
              <tr>
                <th>
                  <span className="ed-vh">Урок</span>
                </th>
                {shortDay.map((d, i) => (
                  <th key={d} title={weekdays[i]}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => {
                const bell = data.bells.find((b) => b.lessonNumber === n);
                return (
                  <tr key={n}>
                    <th scope="row">
                      {n}
                      {bell && <small>{bell.start}</small>}
                    </th>
                    {shortDay.map((d, i) => {
                      const weekday = i + 1;
                      const own = lessonsForDay(mine, weekday).find((l) => l.lessonNumber === n);
                      if (own)
                        return (
                          <td key={d}>
                            <div className="hr-mine" title="Ваш урок — меняется в «Расписании»">
                              <b>{own.subject.trim() || 'Ваш урок'}</b>
                              <span>ваш урок</span>
                            </div>
                          </td>
                        );
                      const lesson = homeroom.lessons.find(
                        (l) => l.weekday === weekday && l.lessonNumber === n,
                      );
                      const label = `${weekdays[i]}, ${n}-й урок`;
                      return (
                        <td key={d}>
                          <div className={`hr-cell ${lesson ? '' : 'blank'}`}>
                            <input
                              aria-label={`${label}: предмет`}
                              placeholder="+"
                              list="hr-subjects"
                              value={lesson?.subject ?? ''}
                              onChange={(e) => set(weekday, n, { subject: e.target.value })}
                            />
                            <input
                              aria-label={`${label}: кабинет`}
                              placeholder="каб."
                              className="hr-room"
                              maxLength={40}
                              value={lesson?.room ?? ''}
                              onChange={(e) => set(weekday, n, { room: e.target.value })}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <datalist id="hr-subjects">
            {unique([
              ...homeroom.lessons.map((l) => l.subject),
              ...data.lessons.map((l) => l.subject),
            ]).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </section>
      )}
    </>
  );
}
