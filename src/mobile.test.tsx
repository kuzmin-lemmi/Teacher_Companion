// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileSettings } from './MobileSettings';
import { emptyData, type AppData } from './domain';
import type { Storage } from './storage';
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
function setup(data: AppData, initial: 'lessons' | 'bells' = 'lessons') {
  const { state, storage } = memory(data);
  render(
    <MobileSettings
      initial={initial}
      data={data}
      editorStorage={storage}
      onDirty={() => {}}
      onRestore={async () => {}}
      onSaveSettings={async () => {}}
      onExit={() => {}}
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
});
