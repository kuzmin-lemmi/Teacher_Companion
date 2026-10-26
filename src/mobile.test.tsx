// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileSettings } from './MobileSettings';
import { emptyData, type AppData } from './domain';
import type { Storage } from './storage';
// «Плюс» в тестах включается и выключается: по умолчанию — куплен.
const plus = vi.hoisted(() => ({ on: true }));
vi.mock('./plus', () => ({
  hasPlus: () => plus.on,
  showsPlus: () => plus.on,
  PLUS_ON_SALE: false,
}));
afterEach(cleanup);
function memory(initial: AppData) {
  const state = { data: initial };
  const storage: Storage = {
    load: async () => state.data,
    save: async (value) => {
      state.data = value;
    },
  };
  return { state, storage };
}
function setup(
  data: AppData,
  initial: 'lessons' | 'bells' | 'notify' | 'calendar' | 'menu' = 'lessons',
  open?: string,
  onExit = () => {},
) {
  const { state, storage } = memory(data);
  render(
    <MobileSettings
      initial={initial}
      open={open}
      data={data}
      editorStorage={storage}
      onDirty={() => {}}
      onRestore={async () => {}}
      onSaveSettings={async () => {}}
      onExit={onExit}
    />,
  );
  return state;
}
describe('настройки на телефоне', () => {
  it('новый урок получает частые предмет и кабинет, остаётся вписать класс', async () => {
    const user = userEvent.setup();
    const data: AppData = {
      ...emptyData(),
      lessons: [1, 2, 3, 4, 5].map((weekday) => ({
        id: `l${weekday}`,
        weekday,
        lessonNumber: 1,
        className: '5А',
        subject: 'Математика',
        room: '214',
      })),
      bells: [{ lessonNumber: 1, start: '08:30', end: '09:15' }],
    };
    const state = setup(data);
    await user.click(await screen.findByRole('button', { name: /Добавить 2-й урок/ }));
    expect(screen.getByRole('dialog', { name: 'Новый урок' })).toBeTruthy();
    expect(screen.getByLabelText('Предмет')).toHaveProperty('value', 'Математика');
    expect(screen.getByLabelText('Кабинет')).toHaveProperty('value', '214');
    await user.click(screen.getByRole('button', { name: '5А' }));
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(state.data.lessons).toHaveLength(6), { timeout: 2000 });
    const added = state.data.lessons.find((l) => l.lessonNumber === 2)!;
    expect(added).toMatchObject({ className: '5А', subject: 'Математика', room: '214' });
  });
  it('новый урок без класса не сохраняется', async () => {
    const user = userEvent.setup();
    setup(emptyData());
    await user.click(await screen.findByRole('button', { name: /Добавить 1-й урок/ }));
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.queryByText('Укажите класс')).toBeNull();
    expect(screen.getByText(/уроков нет/)).toBeTruthy();
  });
  it('звонки заполняются разом, следующий продолжает ритм', async () => {
    const user = userEvent.setup();
    const state = setup(emptyData(), 'bells');
    await user.click(await screen.findByRole('button', { name: 'Заполнить звонки' }));
    await user.click(screen.getByRole('button', { name: /Заполнить: 08:30–/ }));
    await waitFor(() => expect(state.data.bells).toHaveLength(7), { timeout: 2000 });
    expect(state.data.bells[1]).toEqual({ lessonNumber: 2, start: '09:25', end: '10:10' });
    await user.click(screen.getByRole('button', { name: 'Добавить звонок' }));
    expect(screen.getByLabelText('Начало')).toHaveProperty('value', '14:55');
  });
  it('уведомление открывается на своём экране: пример, когда, как сообщать — и назад к списку', async () => {
    const user = userEvent.setup();
    localStorage.clear();
    setup(emptyData(), 'notify');
    const row = screen.getByRole('button', { name: /Перед концом урока/ });
    expect(row.textContent).toContain('За 5 мин до звонка · вибрация');
    await user.click(row);
    expect(screen.getByRole('heading', { name: 'Перед концом урока' })).toBeTruthy();
    expect(screen.getByLabelText('Пример уведомления').textContent).toContain(
      'Пора подводить итоги и задавать ДЗ',
    );
    await user.click(screen.getByRole('button', { name: 'За 10 мин' }));
    await user.click(screen.getByRole('radio', { name: /^Звук/ }));
    // Выключили и включили снова — минуты прежние.
    await user.click(screen.getByRole('switch', { name: /Присылать/ }));
    expect(screen.queryByRole('group', { name: 'Когда' })).toBeNull();
    await user.click(screen.getByRole('switch', { name: /Присылать/ }));
    expect(screen.getByRole('button', { name: 'За 10 мин' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'К уведомлениям' }));
    expect(screen.getByRole('button', { name: /Перед концом урока/ }).textContent).toContain(
      'За 10 мин до звонка · со звуком',
    );
    localStorage.clear();
  });
  it('без «Плюса» в уведомлениях только утренняя сводка и урок в шторке', async () => {
    plus.on = false;
    localStorage.clear();
    setup(emptyData(), 'notify');
    expect(screen.getByRole('button', { name: /Утренняя сводка/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Перед уроком/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Перед концом урока/ })).toBeNull();
    expect(screen.queryByRole('switch', { name: /Не звенеть на уроке/ })).toBeNull();
    expect(screen.getByRole('switch', { name: /Урок в шторке/ })).toBeTruthy();
    plus.on = true;
  });
  it('каникулы с главного экрана: один день — одна дата, несколько — от и до', async () => {
    const user = userEvent.setup();
    const state = setup(emptyData(), 'calendar', 'new');
    expect(await screen.findByRole('dialog', { name: 'Новые каникулы' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Один день' }));
    expect(screen.getByRole('dialog', { name: 'Новый выходной' })).toBeTruthy();
    expect(screen.queryByLabelText('По')).toBeNull();
    fireEvent.change(screen.getByLabelText('Дата'), { target: { value: '2026-11-04' } });
    await user.click(screen.getByRole('button', { name: 'Праздник' }));
    await user.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(
      () =>
        expect(state.data.holidays).toMatchObject([
          { title: 'Праздник', start: '2026-11-04', end: '2026-11-04' },
        ]),
      { timeout: 2000 },
    );
  });
  it('новые каникулы, закрытые пустыми, не делают сегодня выходным', async () => {
    const user = userEvent.setup();
    const exit = vi.fn();
    const state = setup(emptyData(), 'calendar', 'new', exit);
    await screen.findByRole('dialog', { name: 'Новые каникулы' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await new Promise((r) => setTimeout(r, 600));
    expect(state.data.holidays).toEqual([]);
    // Открыли с главного экрана — «Назад» ведёт сразу к расписанию.
    await user.click(screen.getByRole('button', { name: 'К расписанию' }));
    expect(exit).toHaveBeenCalled();
  });
  it('версия для компьютера: ссылку можно отправить себе', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup(emptyData(), 'menu');
    await user.click(screen.getByRole('button', { name: /Версия для компьютера/ }));
    await user.click(screen.getByRole('button', { name: 'Отправить ссылку на компьютер' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('TeacherCompanion-Setup.exe'));
    expect(screen.getByRole('status').textContent).toContain('Ссылка скопирована');
  });
});
