// @vitest-environment jsdom
import { afterEach, it, expect } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { emptyData, type AppData } from './domain';
import { browserStorage, type Storage } from './storage';
afterEach(cleanup);
function memory() {
  const items = new Map<string, string>();
  return {
    items,
    storage: browserStorage({
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => void items.set(k, v),
      removeItem: (k) => void items.delete(k),
    }),
    state: () => JSON.parse(items.get('teacher-companion-preview-v1') ?? 'null') as AppData | null,
  };
}
it('сохраняет урок автоматически, после перезапуска редактирует и удаляет', async () => {
  const { storage, state } = memory();
  const user = userEvent.setup();
  const app = render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  expect(screen.queryByText('Сохранить изменения')).toBeNull();
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '6А');
  await screen.findByText('Сохранено автоматически');
  expect(state()!.lessons[0].className).toBe('6А');
  app.unmount();
  render(<App storage={storage} />);
  await screen.findByDisplayValue('6А');
  await user.clear(screen.getByLabelText('Класс *'));
  await user.type(screen.getByLabelText('Класс *'), '7Б');
  await waitFor(() => expect(state()!.lessons[0].className).toBe('7Б'));
  await user.click(screen.getByLabelText('Удалить урок 1'));
  await waitFor(() => expect(state()!.lessons).toHaveLength(0));
});
it('правки не теряются, даже если редактор закрыли сразу после ввода', async () => {
  const { storage, state } = memory();
  const user = userEvent.setup();
  const app = render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '9В');
  app.unmount();
  await waitFor(() => expect(state()?.lessons[0]?.className).toBe('9В'));
});
it('правки с ошибкой хранятся черновиком и возвращаются после перезапуска', async () => {
  const { storage, state } = memory();
  const user = userEvent.setup();
  const app = render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Кабинет'), '12');
  await screen.findByText(/Черновик сохранён/);
  expect(state()).toBeNull();
  app.unmount();
  render(<App storage={storage} />);
  await screen.findByText(/Восстановлен черновик/);
  expect(screen.getByDisplayValue('12')).toBeTruthy();
  await user.type(screen.getByLabelText('Класс *'), '5А');
  await screen.findByText('Сохранено автоматически');
  expect(state()!.lessons[0]).toMatchObject({ className: '5А', room: '12' });
  expect(await storage.loadDraft!()).toBeNull();
});
it('при ошибке записи оставляет правки в черновике и позволяет повторить', async () => {
  let fail = true;
  let saved: AppData | null = null;
  let draft: AppData | null = null;
  const storage: Storage = {
    load: async () => emptyData(),
    save: async (d) => {
      if (fail) throw new Error('disk');
      saved = d;
    },
    loadDraft: async () => null,
    saveDraft: async (d) => void (draft = d),
  };
  const user = userEvent.setup();
  render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '8В');
  await screen.findByText(/Не удалось сохранить/);
  expect(draft!.lessons[0].className).toBe('8В');
  fail = false;
  await user.click(screen.getByText('Повторить сохранение'));
  await screen.findByText('Сохранено автоматически');
  expect(saved!.lessons[0].className).toBe('8В');
});
it('редактирует звонки и индивидуальное время, отменяет изменения', async () => {
  const { storage, state } = memory();
  const user = userEvent.setup();
  render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText(/Звонки/));
  await user.click(screen.getByText('+ Добавить звонок'));
  await user.type(screen.getByLabelText('Начало'), '08:30');
  await user.type(screen.getByLabelText('Окончание'), '09:15');
  await waitFor(() => expect(state()?.bells[0]?.end).toBe('09:15'));
  await user.click(screen.getByRole('button', { name: /▦.*Расписание/ }));
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '5А');
  expect(screen.getByText('08:30 — 09:15')).toBeTruthy();
  await user.click(screen.getByLabelText('Индивидуальное время'));
  await user.clear(screen.getByLabelText('Начало'));
  await user.type(screen.getByLabelText('Начало'), '08:35');
  await waitFor(() => expect(state()!.lessons[0].customTime?.start).toBe('08:35'));
  await user.click(screen.getByText('Отменить изменения'));
  await waitFor(() => expect(state()).toMatchObject({ lessons: [], bells: [] }));
});
