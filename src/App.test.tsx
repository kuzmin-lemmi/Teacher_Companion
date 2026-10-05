// @vitest-environment jsdom
import { afterEach, it, expect } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
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
it('черновик возвращает только правки расписания: заметки и настройки после него не пропадают', async () => {
  const { storage, state } = memory();
  const notes = [{ date: '2026-09-25', lessonNumber: 1, text: 'контрольная' }];
  // Черновик сохранён раньше, чем в виджете появилась заметка и сменилась тема.
  await storage.saveDraft!({
    ...emptyData(),
    lessons: [{ id: 'x', weekday: 1, lessonNumber: 1, className: '', subject: '', room: '12' }],
  });
  await storage.save({
    ...emptyData(),
    notes,
    settings: { ...emptyData().settings, theme: 'light' },
  });
  const user = userEvent.setup();
  render(<App storage={storage} />);
  await screen.findByText(/Восстановлен черновик/);
  await user.type(screen.getByLabelText('Класс *'), '5А');
  await screen.findByText('Сохранено автоматически');
  expect(state()!.lessons[0]).toMatchObject({ className: '5А', room: '12' });
  expect(state()!.notes).toEqual(notes);
  expect(state()!.settings.theme).toBe('light');
});
it('«Отменить изменения» убирает и черновик — после перезапуска он не возвращается', async () => {
  const { storage } = memory();
  const user = userEvent.setup();
  const app = render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await screen.findByText(/Черновик сохранён/);
  await user.click(screen.getByText('Отменить изменения'));
  await waitFor(async () => expect(await storage.loadDraft!()).toBeNull());
  app.unmount();
  render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  expect(screen.queryByText(/Восстановлен черновик/)).toBeNull();
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
  // Следующий звонок продолжает ритм, а не появляется с пустым временем.
  await user.click(screen.getByText('+ Добавить звонок'));
  await waitFor(() =>
    expect(state()?.bells[1]).toEqual({ lessonNumber: 2, start: '09:25', end: '10:10' }),
  );
  await user.click(screen.getByRole('button', { name: /▦.*Расписание/ }));
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '5А');
  expect(screen.getByText('08:30–09:15')).toBeTruthy();
  await user.click(screen.getByLabelText('Индивидуальное время'));
  await user.clear(screen.getByLabelText('Начало'));
  await user.type(screen.getByLabelText('Начало'), '08:35');
  await waitFor(() => expect(state()!.lessons[0].customTime?.start).toBe('08:35'));
  await user.click(screen.getByText('Отменить изменения'));
  await waitFor(() => expect(state()).toMatchObject({ lessons: [], bells: [] }));
});
it('редактирует каникулы, праздники и сокращённые дни', async () => {
  const { storage, state } = memory();
  await storage.save({
    ...emptyData(),
    bells: [
      { lessonNumber: 1, start: '08:00', end: '08:45' },
      { lessonNumber: 2, start: '08:55', end: '09:40' },
    ],
  });
  const user = userEvent.setup();
  render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByRole('button', { name: /☼.*Каникулы/ }));
  await user.click(screen.getByText('+ Добавить период'));
  await user.type(screen.getByLabelText('Название'), 'Осенние каникулы');
  fireEvent.change(screen.getByLabelText('По'), { target: { value: '2026-11-06' } });
  fireEvent.change(screen.getByLabelText('С'), { target: { value: '2026-10-26' } });
  await waitFor(() =>
    expect(state()!.holidays).toMatchObject([
      { title: 'Осенние каникулы', start: '2026-10-26', end: '2026-11-06' },
    ]),
  );
  await user.click(screen.getByText('+ Праздники учебного года'));
  await waitFor(() => expect(state()!.holidays).toHaveLength(7));
  await user.click(screen.getByText('+ Добавить дату'));
  await user.click(screen.getByText('Рассчитать от обычных звонков'));
  await waitFor(() =>
    expect(state()!.shortBells).toEqual([
      { lessonNumber: 1, start: '08:00', end: '08:30' },
      { lessonNumber: 2, start: '08:40', end: '09:10' },
    ]),
  );
  expect(state()!.shortDays).toHaveLength(1);
});
it('Enter в последнем уроке добавляет новый, следующий урок наследует предмет и кабинет', async () => {
  const { storage, state } = memory();
  const user = userEvent.setup();
  render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '6А');
  await user.type(screen.getByLabelText('Предмет'), 'Информатика');
  await user.type(screen.getByLabelText('Кабинет'), '12{Enter}');
  await user.type(screen.getAllByLabelText('Класс *')[0], '{Enter}');
  const classes = await screen.findAllByLabelText('Класс *');
  expect(classes).toHaveLength(2);
  expect(document.activeElement).toBe(classes[1]);
  expect((screen.getAllByLabelText('Предмет')[1] as HTMLInputElement).value).toBe('Информатика');
  expect((screen.getAllByLabelText('Кабинет')[1] as HTMLInputElement).value).toBe('12');
});
it('пустой день копируется из другого, неделя показывает все дни и добавляет урок в пустую клетку', async () => {
  const { storage, state } = memory();
  const user = userEvent.setup();
  render(<App storage={storage} />);
  await screen.findByText('Здесь будет расписание');
  await user.click(screen.getByText('+ Добавить урок'));
  await user.type(screen.getByLabelText('Класс *'), '6А');
  await waitFor(() => expect(state()!.lessons).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: /^Вторник/ }));
  await user.click(screen.getByRole('button', { name: /Скопировать день/ }));
  await user.click(screen.getByRole('button', { name: /^Понедельник · 1 урок/ }));
  await waitFor(() =>
    expect(
      state()!
        .lessons.map((l) => l.weekday)
        .sort(),
    ).toEqual([1, 2]),
  );
  await user.click(screen.getByRole('button', { name: 'Неделя' }));
  await user.click(screen.getByLabelText('Добавить урок 2, Среда'));
  expect(screen.getByRole('button', { name: /^Среда/ }).getAttribute('aria-pressed')).toBe('true');
  const field = await screen.findByLabelText('Класс *');
  expect(document.activeElement).toBe(field);
  expect((screen.getByLabelText('Номер урока 1') as HTMLInputElement).value).toBe('2');
});
