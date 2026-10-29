// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { HomeroomGrid } from './HomeroomGrid';
import { Widget } from './Widget';
import { emptyData, type AppData } from './domain';
afterEach(cleanup);
function data(): AppData {
  const d = emptyData();
  d.lessons = [
    { id: 'm', weekday: 1, lessonNumber: 2, className: '7Б', subject: 'Математика', room: '12' },
  ];
  d.homeroom = { enabled: true, className: '7Б', lessons: [] };
  return d;
}
function Editor({ onChange }: { onChange: (d: AppData) => void }) {
  const [value, setValue] = useState(data);
  return (
    <HomeroomGrid
      data={value}
      change={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}
it('компьютер: предмет в клетке становится уроком класса, пустая клетка — снова пустой', () => {
  const onChange = vi.fn();
  render(<Editor onChange={onChange} />);
  // Свой урок учителя в 7Б подставлен сам и не правится.
  expect(screen.getByText('Математика')).toBeTruthy();
  expect(screen.queryByLabelText('Понедельник, 2-й урок: предмет')).toBeNull();
  const cell = screen.getByLabelText('Понедельник, 1-й урок: предмет');
  fireEvent.change(cell, { target: { value: 'Русский язык' } });
  const added = onChange.mock.lastCall![0] as AppData;
  expect(added.homeroom!.lessons).toMatchObject([
    { weekday: 1, lessonNumber: 1, subject: 'Русский язык', room: '' },
  ]);
  fireEvent.change(cell, { target: { value: '' } });
  expect((onChange.mock.lastCall![0] as AppData).homeroom!.lessons).toEqual([]);
});
it('виджет: «Неделя» переключается на неделю своего класса', () => {
  const d = data();
  d.homeroom!.lessons = [
    { id: 'c', weekday: 1, lessonNumber: 1, subject: 'История', room: '', teacher: '' },
  ];
  render(
    <Widget
      data={d}
      mode="today"
      onMode={vi.fn()}
      onSettings={vi.fn()}
      onClose={vi.fn()}
      onLock={vi.fn()}
      onDrag={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Вся неделя' }));
  fireEvent.click(screen.getByRole('button', { name: '7Б' }));
  expect(screen.getByText('Класс 7Б')).toBeTruthy();
  expect(screen.getByText('Ист.')).toBeTruthy();
  expect(screen.getByText('Мат.')).toBeTruthy();
});
