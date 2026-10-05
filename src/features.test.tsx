// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Shell } from './Shell';
import { Widget } from './Widget';
import { emptyData, type AppData } from './domain';
import { browserStorage } from './storage';
import { parseBackup, serializeBackup } from './backup';
import { millisecondsUntilMidnight } from './calendar';
import { safePosition } from './geometry';
import { useToday } from './hooks';
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function fixture(): AppData {
  return {
    ...emptyData(),
    onboardingComplete: true,
    lessons: [
      {
        id: 'one',
        weekday: 5,
        lessonNumber: 1,
        className: '6А',
        subject: 'Математика',
        room: '201',
      },
      { id: 'three', weekday: 5, lessonNumber: 3, className: '7Б', subject: 'Алгебра', room: '' },
    ],
    bells: [
      { lessonNumber: 1, start: '08:30', end: '09:15' },
      { lessonNumber: 3, start: '10:20', end: '11:05' },
    ],
  };
}
describe('резервные копии', () => {
  it('восстанавливает весь документ без потери настроек', () =>
    expect(parseBackup(serializeBackup(fixture()))).toEqual(fixture()));
  it('отклоняет чужой формат, поврежденный JSON и некорректные уроки', () => {
    expect(() => parseBackup('{}')).toThrow();
    expect(() => parseBackup('{')).toThrow();
    expect(() =>
      parseBackup(
        serializeBackup({
          ...fixture(),
          lessons: [{ ...fixture().lessons[0], customTime: null as never }],
        }),
      ),
    ).toThrow();
  });
  it('демонстрационная копия из документации восстанавливается', () => {
    const raw = readFileSync('docs/examples/demo-backup.json', 'utf8');
    expect(parseBackup(raw).lessons.length).toBeGreaterThan(20);
  });
  it('отклоняет превышение лимита', () =>
    expect(() => parseBackup('x'.repeat(1_000_001))).toThrow('слишком большой'));
  it('понятно отказывает, если в копии нет расписания', () =>
    expect(() =>
      parseBackup(JSON.stringify({ application: 'teacher-companion', backupVersion: 1 })),
    ).toThrow('в ней нет расписания'));
});
describe('координаты', () => {
  const areas = [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -2560, y: 0, width: 2560, height: 1400 },
  ];
  it('первый запуск в правом верхнем углу', () =>
    expect(safePosition(null, { width: 380, height: 560 }, areas)).toEqual({ x: 1524, y: 16 }));
  it('ставит виджет в выбранный угол', () => {
    const size = { width: 300, height: 400 };
    expect(safePosition(null, size, areas, 'top-left')).toEqual({ x: 16, y: 16 });
    expect(safePosition(null, size, areas, 'bottom-right')).toEqual({ x: 1604, y: 624 });
    expect(safePosition(null, size, areas, 'bottom-left')).toEqual({ x: 16, y: 624 });
  });
  it('перетащенная позиция важнее выбранного угла', () =>
    expect(
      safePosition({ x: 700, y: 300 }, { width: 300, height: 400 }, areas, 'top-left'),
    ).toEqual({ x: 700, y: 300 }));
  it('сохраняет положение на мониторе с отрицательными координатами', () =>
    expect(safePosition({ x: -1500, y: 50 }, { width: 380, height: 560 }, areas)).toEqual({
      x: -1500,
      y: 50,
    }));
  it('возвращает окно на экран после отключения монитора', () => {
    const p = safePosition({ x: 2800, y: 1500 }, { width: 380, height: 560 }, areas.slice(0, 1));
    expect(p.x).toBeLessThanOrEqual(1540);
    expect(p.y).toBeLessThanOrEqual(480);
  });
});
it('обновляет дату в полночь и после возвращения к приложению', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 23, 59, 59));
  function Clock() {
    return <span>{useToday().getDate()}</span>;
  }
  render(<Clock />);
  expect(screen.getByText('24')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1100));
  expect(screen.getByText('25')).toBeTruthy();
  act(() => {
    vi.setSystemTime(new Date(2026, 8, 28, 9));
    window.dispatchEvent(new Event('focus'));
  });
  expect(screen.getByText('28')).toBeTruthy();
  expect(millisecondsUntilMidnight(new Date(2026, 8, 24, 23, 59, 59))).toBe(1050);
});
it('показывает время, окно и компактный режим', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 12));
  const props = {
    data: { ...fixture(), settings: { ...fixture().settings, widgetSize: 'normal' as const } },
    mode: 'next' as const,
    onMode: vi.fn(),
    onSettings: vi.fn(),
    onClose: vi.fn(),
    onLock: vi.fn(),
    onDrag: vi.fn(),
  };
  const view = render(<Widget {...props} />);
  expect(screen.getByText('Пятница')).toBeTruthy();
  expect(screen.getByText('Завтра, 25 сентября')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Завтра' })).toBeTruthy();
  expect(screen.getByText('08:30–09:15')).toBeTruthy();
  expect(screen.getByText('Математика')).toBeTruthy();
  expect(screen.getByText('каб. 201')).toBeTruthy();
  expect(screen.getByText('окно')).toBeTruthy();
  view.rerender(
    <Widget
      {...props}
      data={{ ...fixture(), settings: { ...fixture().settings, widgetSize: 'compact' } }}
    />,
  );
  expect(screen.getByText('08:30')).toBeTruthy();
  expect(screen.queryByText('08:30–09:15')).toBeNull();
  expect(screen.queryByText('Математика')).toBeNull();
  expect(screen.getByText('6А')).toBeTruthy();
});
it('выделяет текущий урок и выносит общий предмет в подвал', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 25, 10, 30));
  const data = fixture();
  data.settings.widgetSize = 'normal';
  data.lessons = data.lessons.map((l) => ({ ...l, subject: 'Информатика', room: '12' }));
  render(
    <Widget
      data={data}
      mode="today"
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
      onLock={vi.fn()}
      onDrag={vi.fn()}
    />,
  );
  expect(screen.getByText('Информатика · каб. 12')).toBeTruthy();
  expect(screen.queryByText('каб. 201')).toBeNull();
  const current = screen.getByText('7Б').closest('.widget-row')!;
  expect(current.getAttribute('aria-current')).toBe('time');
  expect(screen.getByText('6А').closest('.widget-row')!.className).toContain('past');
});
it('показывает отсчёт до конца урока и до начала следующего', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 25, 10, 42, 10));
  const props = {
    data: fixture(),
    mode: 'today' as const,
    onMode: vi.fn(),
    onSettings: vi.fn(),
    onClose: vi.fn(),
    onLock: vi.fn(),
    onDrag: vi.fn(),
  };
  render(<Widget {...props} />);
  const row = screen.getByText('ещё 23 мин').closest('.widget-row') as HTMLElement;
  expect(row.textContent).toContain('7Б');
  expect(row.style.getPropertyValue('--progress')).toMatch(/^49\.\d+%$/);
  // Тик ровно на смене минуты.
  act(() => vi.advanceTimersByTime(50_100));
  expect(screen.getByText('ещё 22 мин')).toBeTruthy();
  act(() => {
    vi.setSystemTime(new Date(2026, 8, 25, 10, 5));
    window.dispatchEvent(new Event('focus'));
  });
  const next = screen.getByText('через 15 мин').closest('.widget-row')!;
  expect(next.className).toContain('upcoming');
  expect(next.textContent).toContain('7Б');
});
it('сам выбирает сегодня или следующий день, ручной выбор действует до конца суток', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 25, 10, 30));
  const user = userEvent.setup();
  const data = fixture();
  render(<Shell storage={{ load: async () => data, save: async () => {} }} />);
  await screen.findByText('25 сентября');
  expect(screen.getByRole('button', { name: 'Сегодня' }).getAttribute('aria-pressed')).toBe('true');
  act(() => {
    vi.setSystemTime(new Date(2026, 8, 25, 12));
    window.dispatchEvent(new Event('focus'));
  });
  await screen.findByText('2 октября');
  await user.click(screen.getByRole('button', { name: 'Сегодня' }));
  await screen.findByText('25 сентября');
  act(() => {
    vi.setSystemTime(new Date(2026, 9, 2, 12));
    window.dispatchEvent(new Event('focus'));
  });
  await screen.findByText('9 октября');
});
it('первый запуск сразу открывает виджет: настроить расписание или загрузить копию', async () => {
  const user = userEvent.setup();
  const storage = { load: async () => emptyData(), save: async () => {} };
  const app = render(<Shell storage={storage} />);
  await screen.findByLabelText('Виджет расписания');
  await screen.findByText('Добавьте первые уроки');
  await user.click(screen.getByText('Загрузить резервную копию'));
  await screen.findByText('Ваши данные');
  app.unmount();
  render(<Shell storage={storage} />);
  await screen.findByLabelText('Виджет расписания');
  await user.click(screen.getByText('Настроить расписание'));
  await screen.findByText('Здесь будет расписание');
});
it('сохраняет настройки и защищает черновик при выходе', async () => {
  const user = userEvent.setup();
  let saved = fixture();
  render(
    <Shell
      storage={{
        load: async () => saved,
        save: async (d) => {
          saved = d;
        },
      }}
    />,
  );
  await screen.findByLabelText('Виджет расписания');
  await user.click(screen.getByLabelText('Открыть настройки'));
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('Внешний вид'));
  await user.selectOptions(screen.getByLabelText('Тема'), 'light');
  await user.click(screen.getByText('К виджету'));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await user.click(screen.getByText('Остаться'));
  await user.click(screen.getByText('Сохранить настройки'));
  await screen.findByText('Настройки сохранены');
  expect(saved.settings.theme).toBe('light');
  await user.click(screen.getByText('К виджету'));
  await screen.findByLabelText('Виджет расписания');
});
it('импорт требует явного подтверждения и сохраняет локальный автозапуск', async () => {
  const user = userEvent.setup();
  let saved = { ...fixture(), settings: { ...fixture().settings, launchOnStartup: false } };
  render(
    <Shell
      storage={{
        load: async () => saved,
        save: async (d) => {
          saved = d;
        },
      }}
    />,
  );
  await screen.findByLabelText('Виджет расписания');
  await user.click(screen.getByLabelText('Открыть настройки'));
  await user.click(screen.getByText('Копии'));
  const backup = {
    ...fixture(),
    lessons: [],
    settings: { ...fixture().settings, launchOnStartup: true },
  };
  const file = new File([serializeBackup(backup)], 'backup.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => serializeBackup(backup) });
  fireEvent.change(screen.getByLabelText('Файл резервной копии'), { target: { files: [file] } });
  await screen.findByText('Копия готова к восстановлению');
  expect(saved.lessons).toHaveLength(2);
  await user.click(screen.getByText('Восстановить эту копию'));
  await screen.findByText('Расписание восстановлено');
  expect(saved.lessons).toHaveLength(0);
  expect(saved.settings.launchOnStartup).toBe(false);
});
it('ошибка загрузки позволяет восстановить валидную копию', async () => {
  let restored: AppData | null = null;
  render(
    <Shell
      storage={{
        load: async () => {
          throw new Error('broken');
        },
        save: async (d) => {
          restored = d;
        },
      }}
    />,
  );
  await screen.findByText('Расписание недоступно');
  const file = new File([''], 'backup.json');
  Object.defineProperty(file, 'text', { value: async () => serializeBackup(fixture()) });
  fireEvent.change(screen.getByLabelText('Файл резервной копии'), { target: { files: [file] } });
  await screen.findByText('Копия готова к восстановлению');
  fireEvent.click(screen.getByText('Восстановить эту копию'));
  await waitFor(() => expect(restored).not.toBeNull());
  await screen.findByText('Ваши данные');
});
it('показывает всю неделю и скрывает её крестиком или Esc', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 24, 12));
  const data = fixture();
  data.lessons.push({
    id: 'mon',
    weekday: 1,
    lessonNumber: 2,
    className: '9В',
    subject: '',
    room: '',
  });
  render(
    <Widget
      data={data}
      mode="next"
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
      onLock={vi.fn()}
      onDrag={vi.fn()}
    />,
  );
  expect(screen.queryByText('9В')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Вся неделя' }));
  expect(screen.getByRole('table')).toBeTruthy();
  expect(screen.getByText('9В')).toBeTruthy();
  expect(screen.getByText('7Б')).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'Чт' }).className).toContain('today');
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть неделю' }));
  expect(screen.queryByRole('table')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Вся неделя' }));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('table')).toBeNull();
});
it('делает автоматическую копию при запуске и восстанавливает её из списка', async () => {
  const items = new Map<string, string>();
  const storage = browserStorage({
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  });
  await storage.save(fixture());
  const user = userEvent.setup();
  render(<Shell storage={storage} />);
  await screen.findByText('6А');
  await waitFor(async () => expect(await storage.listSnapshots!()).toHaveLength(1));
  await storage.save({ ...fixture(), lessons: [] });
  await user.click(screen.getByRole('button', { name: 'Открыть настройки' }));
  await user.click(await screen.findByRole('button', { name: 'Копии' }));
  await user.click(await screen.findByRole('button', { name: /Восстановить копию от/ }));
  await user.click(await screen.findByText('Восстановить эту копию'));
  await screen.findByText('Расписание восстановлено');
  expect((await storage.load()).lessons).toHaveLength(2);
  expect((await storage.listSnapshots!())[0].reason).toBe('before-restore');
});
describe('черновик редактора', () => {
  function memory() {
    const items = new Map<string, string>();
    return browserStorage({
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => void items.set(k, v),
      removeItem: (k) => void items.delete(k),
    });
  }
  /** Урок без класса — правка с ошибкой: она остаётся черновиком, выходим из редактора. */
  async function leaveDraft(user: ReturnType<typeof userEvent.setup>, exit: string) {
    await user.click(await screen.findByRole('button', { name: 'Открыть настройки' }));
    await user.click(await screen.findByText('+ Добавить урок'));
    await screen.findByText(/Черновик сохранён/);
    await user.click(screen.getByText(exit));
    await user.click(await screen.findByText('Выйти, черновик сохранён'));
  }
  it('не затирает заметку, добавленную в виджете после него', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 12));
    const storage = memory();
    await storage.save(fixture());
    const user = userEvent.setup();
    render(<Shell storage={storage} />);
    await leaveDraft(user, 'К виджету');
    await user.click(await screen.findByText('7Б'));
    await user.type(screen.getByLabelText('Заметка к уроку 3, 7Б'), 'контрольная{Enter}');
    await waitFor(async () => expect((await storage.load()).notes).toHaveLength(1));
    // Снова редактор: черновик вернулся, исправляем ошибку — правка сохраняется.
    await user.click(screen.getByRole('button', { name: 'Открыть настройки' }));
    await screen.findByText(/Восстановлен черновик/);
    await user.type(screen.getByLabelText('Класс *'), '9В');
    await screen.findByText('Сохранено автоматически');
    const saved = await storage.load();
    expect(saved.lessons.map((l) => l.className)).toEqual(['6А', '7Б', '9В']);
    expect(saved.notes).toEqual([{ date: '2026-09-25', lessonNumber: 3, text: 'контрольная' }]);
  });
  it('восстановление копии сбрасывает черновик', async () => {
    const storage = memory();
    await storage.save(fixture());
    const user = userEvent.setup();
    render(<Shell storage={storage} />);
    await leaveDraft(user, 'Копии');
    const file = new File([''], 'backup.json');
    Object.defineProperty(file, 'text', { value: async () => serializeBackup(fixture()) });
    fireEvent.change(screen.getByLabelText('Файл резервной копии'), { target: { files: [file] } });
    await user.click(await screen.findByText('Восстановить эту копию'));
    await screen.findByText('Расписание восстановлено');
    expect(await storage.loadDraft!()).toBeNull();
    await user.click(screen.getByText('Расписание'));
    await screen.findByText('Недельное расписание');
    expect(screen.queryByText(/Восстановлен черновик/)).toBeNull();
  });
});
it('показывает новую версию ненавязчиво и ставит её только по кнопке', async () => {
  const items = new Map<string, string>();
  const storage = browserStorage({
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
  });
  await storage.save(fixture());
  const install = vi.fn(async (progress: (p: number | null) => void) => progress(100));
  const updates = vi.fn(async () => ({ version: '9.9.9', notes: 'Новое', install }));
  const user = userEvent.setup();
  localStorage.clear();
  render(<Shell storage={storage} updates={updates} />);
  await user.click(await screen.findByRole('button', { name: 'Открыть настройки' }));
  await user.click(await screen.findByRole('button', { name: 'О программе' }));
  await user.click(screen.getByRole('button', { name: 'Проверить обновления' }));
  await screen.findByText('Доступна версия 9.9.9');
  expect(install).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Не сейчас' }));
  expect(screen.queryByRole('button', { name: 'Не сейчас' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Расписание' }));
  expect(screen.queryByText(/Доступна версия/)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'О программе' }));
  await user.click(screen.getByRole('button', { name: 'Установить версию 9.9.9' }));
  await waitFor(() => expect(install).toHaveBeenCalledOnce());
  expect((await storage.listSnapshots!())[0].reason).toBe('update');
});
it('без новой версии сообщает, что установлена последняя', async () => {
  const user = userEvent.setup();
  render(
    <Shell
      storage={{ load: async () => fixture(), save: async () => {} }}
      updates={async () => null}
    />,
  );
  await user.click(await screen.findByRole('button', { name: 'Открыть настройки' }));
  await user.click(await screen.findByRole('button', { name: 'О программе' }));
  await user.click(screen.getByRole('button', { name: 'Проверить обновления' }));
  await screen.findByText('У вас последняя версия.');
});
describe('каникулы, сокращённые дни и заметки на виджете', () => {
  const widget = (data: AppData, mode: 'auto' | 'today' | 'next' = 'auto') => (
    <Widget
      data={data}
      mode={mode}
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
      onLock={vi.fn()}
      onDrag={vi.fn()}
    />
  );
  const autumn = { id: 'h', title: 'Осенние каникулы', start: '2026-10-26', end: '2026-11-06' };
  it('в каникулы сегодня выходной, а сам виджет показывает день после каникул', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 30, 9));
    const data = { ...fixture(), holidays: [autumn] };
    const view = render(widget(data, 'today'));
    expect(screen.getByText('Сегодня выходной')).toBeTruthy();
    expect(screen.getByText('Осенние каникулы · до 6 ноября')).toBeTruthy();
    view.unmount();
    render(widget(data));
    expect(screen.getByText('13 ноября')).toBeTruthy();
    expect(screen.getByText('Осенние каникулы · до 6 ноября')).toBeTruthy();
    expect(screen.getByText('7Б')).toBeTruthy();
  });
  it('в сокращённый день время и отсчёт — по сокращённым звонкам', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 25, 9, 50));
    render(
      widget({
        ...fixture(),
        shortDays: ['2026-09-25'],
        shortBells: [
          { lessonNumber: 1, start: '08:30', end: '09:00' },
          { lessonNumber: 3, start: '09:40', end: '10:10' },
        ],
      }),
    );
    expect(screen.getByText('Сокращённые уроки')).toBeTruthy();
    expect(screen.getByText('ещё 20 мин').closest('.widget-row')!.textContent).toContain('7Б');
  });
  it('заметку к уроку можно добавить прямо в виджете, она сохраняется', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 12));
    const user = userEvent.setup();
    let saved = fixture();
    render(
      <Shell
        storage={{
          load: async () => saved,
          save: async (d) => {
            saved = d;
          },
        }}
      />,
    );
    await user.click(await screen.findByText('7Б'));
    await user.type(screen.getByLabelText('Заметка к уроку 3, 7Б'), 'контрольная{Enter}');
    await screen.findByText('контрольная');
    expect(saved.notes).toEqual([{ date: '2026-09-25', lessonNumber: 3, text: 'контрольная' }]);
    await user.click(screen.getByText('контрольная'));
    await user.type(screen.getByLabelText('Заметка к уроку 3, 7Б'), ' — 2 варианта{Escape}');
    expect(screen.getByText('контрольная')).toBeTruthy();
    await user.click(screen.getByText('контрольная'));
    await user.clear(screen.getByLabelText('Заметка к уроку 3, 7Б'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(saved.notes).toEqual([]));
    expect(screen.queryByText('контрольная')).toBeNull();
  });
  it('заметку можно открыть и с клавиатуры', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 24, 12));
    const user = userEvent.setup();
    render(
      <Widget
        data={fixture()}
        mode="auto"
        onMode={vi.fn()}
        onSettings={vi.fn()}
        onDrag={vi.fn()}
        onNote={vi.fn()}
      />,
    );
    screen.getByRole('button', { name: /7Б/ }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Заметка к уроку 3, 7Б')).toBeTruthy();
  });
});
it('без обработчиков (на телефоне) виджет не показывает «закрепить» и «скрыть»', () => {
  render(
    <Widget data={fixture()} mode="today" onMode={vi.fn()} onSettings={vi.fn()} onDrag={vi.fn()} />,
  );
  expect(screen.queryByRole('button', { name: 'Закрепить виджет' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Закрыть виджет' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Открыть настройки' })).toBeTruthy();
});
describe('телефон', () => {
  const screen_ = (data: AppData, extra: Partial<Parameters<typeof Widget>[0]> = {}) =>
    render(
      <Widget
        data={data}
        mode="today"
        onMode={vi.fn()}
        onSettings={vi.fn()}
        onDrag={vi.fn()}
        layout="screen"
        {...extra}
      />,
    );
  it('весь экран: нижняя панель вместо кнопок в шапке, неделя по кнопке', async () => {
    const user = userEvent.setup();
    const onSettings = vi.fn();
    screen_(fixture(), { onSettings });
    expect(screen.queryByRole('button', { name: 'Вся неделя' })).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Разделы' });
    expect(nav.textContent).toContain('Сегодня');
    await user.click(screen.getByRole('button', { name: 'Неделя' }));
    expect(screen.getByRole('table')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(onSettings).toHaveBeenCalledOnce();
  });
  it('пустой экран предлагает перенести расписание с компьютера', () => {
    const onBackups = vi.fn();
    screen_(emptyData(), { onBackups });
    fireEvent.click(screen.getByRole('button', { name: 'Перенести с компьютера' }));
    expect(onBackups).toHaveBeenCalledOnce();
  });
});
it('на компьютере «Резервные копии» показывают QR-код для телефона', async () => {
  const user = userEvent.setup();
  render(<Shell storage={{ load: async () => fixture(), save: async () => {} }} />);
  await user.click(await screen.findByRole('button', { name: 'Открыть настройки' }));
  await user.click(await screen.findByRole('button', { name: 'Копии' }));
  await user.click(screen.getByRole('button', { name: 'Показать QR-код' }));
  expect(await screen.findByRole('img', { name: 'QR-код с расписанием' })).toBeTruthy();
});
