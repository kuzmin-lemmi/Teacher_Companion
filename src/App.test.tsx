// @vitest-environment jsdom
import { afterEach, it, expect } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { emptyData } from './domain';
import { browserStorage } from './storage';
afterEach(cleanup);
it('добавляет урок, сохраняет после перезапуска, редактирует и удаляет', async () => {
  let raw: string | null = null;
  const storage = browserStorage({
    getItem: () => raw,
    setItem: (_, v) => {
      raw = v;
    },
  });
  const user = userEvent.setup();
  const app = render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '6А');
  await user.click(screen.getByText('Сохранить изменения'));
  await screen.findByText('Изменения сохранены');
  app.unmount();
  render(<App storage={storage} />);
  await screen.findByDisplayValue('6А');
  await user.clear(screen.getByLabelText('Класс *'));
  await user.type(screen.getByLabelText('Класс *'), '7Б');
  await user.click(screen.getByText('Сохранить изменения'));
  await screen.findByText('Изменения сохранены');
  expect(JSON.parse(raw!).lessons[0].className).toBe('7Б');
  await user.click(screen.getByLabelText('Удалить урок 1'));
  await user.click(screen.getByText('Сохранить изменения'));
  await waitFor(() => expect(JSON.parse(raw!).lessons).toHaveLength(0));
});
it('сохраняет черновик при ошибке записи и позволяет повторить', async () => {
  let fail = true;
  const user = userEvent.setup();
  render(
    <App
      storage={{
        load: async () => emptyData(),
        save: async () => {
          if (fail) throw new Error('disk');
        },
      }}
    />,
  );
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '8В');
  await user.click(screen.getByText('Сохранить изменения'));
  await screen.findByText(/Не удалось сохранить/);
  expect(screen.getByDisplayValue('8В')).toBeTruthy();
  fail = false;
  await user.click(screen.getByText('Сохранить изменения'));
  await screen.findByText('Изменения сохранены');
});
it('редактирует звонки и индивидуальное время', async () => {
  const user = userEvent.setup();
  let raw: string | null = null;
  render(
    <App
      storage={browserStorage({
        getItem: () => raw,
        setItem: (_, v) => {
          raw = v;
        },
      })}
    />,
  );
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText(/Звонки/));
  await user.click(screen.getByText('+ Добавить звонок'));
  await user.type(screen.getByLabelText('Начало'), '08:30');
  await user.type(screen.getByLabelText('Окончание'), '09:15');
  await user.click(screen.getByText('Сохранить изменения'));
  await screen.findByText('Изменения сохранены');
  await user.click(screen.getByRole('button', { name: /▦.*Расписание/ }));
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '5А');
  expect(screen.getByText('08:30 — 09:15')).toBeTruthy();
  await user.click(screen.getByLabelText('Индивидуальное время'));
  await user.clear(screen.getByLabelText('Начало'));
  await user.type(screen.getByLabelText('Начало'), '08:35');
  await user.click(screen.getByText('Сохранить изменения'));
  await screen.findByText('Изменения сохранены');
  expect(JSON.parse(raw!).lessons[0].customTime.start).toBe('08:35');
});
