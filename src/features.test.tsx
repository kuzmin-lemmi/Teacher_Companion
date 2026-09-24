// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Shell } from './Shell';
import { Widget } from './Widget';
import { emptyData, type AppData } from './domain';
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
  it('отклоняет превышение лимита', () =>
    expect(() => parseBackup('x'.repeat(1_000_001))).toThrow('слишком большой'));
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
  expect(screen.getByText('пятница')).toBeTruthy();
  expect(screen.getByText('08:30')).toBeTruthy();
  expect(screen.getByText('Окно · 1 урок')).toBeTruthy();
  view.rerender(
    <Widget
      {...props}
      data={{ ...fixture(), settings: { ...fixture().settings, widgetSize: 'compact' } }}
    />,
  );
  expect(screen.queryByText('08:30')).toBeNull();
  expect(screen.getByText('6А')).toBeTruthy();
});
it('проходит первый запуск и запоминает завершение', async () => {
  const user = userEvent.setup();
  let saved = emptyData();
  const storage = {
    load: async () => saved,
    save: async (d: AppData) => {
      saved = d;
    },
  };
  const app = render(<Shell storage={storage} />);
  await screen.findByText('Настроим ваш рабочий день');
  await user.click(screen.getByText('Продолжить'));
  await screen.findByText('Добавьте время первого урока');
  await user.click(screen.getByText('Продолжить'));
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('Продолжить'));
  await screen.findByText('Сделайте виджет своим');
  await user.click(screen.getByText('Продолжить'));
  await user.click(screen.getByText('Открыть виджет'));
  await screen.findByLabelText('Виджет расписания');
  expect(saved.onboardingComplete).toBe(true);
  app.unmount();
  render(<Shell storage={storage} />);
  await screen.findByLabelText('Виджет расписания');
  expect(screen.queryByText('Настроим ваш рабочий день')).toBeNull();
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
  await user.click(screen.getByText('Внешний вид и окно'));
  await user.selectOptions(screen.getByLabelText('Тема'), 'light');
  await user.click(screen.getByText('← К виджету'));
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  await user.click(screen.getByText('Остаться'));
  await user.click(screen.getByText('Сохранить настройки'));
  await screen.findByText('Настройки сохранены');
  expect(saved.settings.theme).toBe('light');
  await user.click(screen.getByText('← К виджету'));
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
  await user.click(screen.getByText('Резервные копии'));
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
