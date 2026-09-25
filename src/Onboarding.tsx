import type { ReactNode } from 'react';
import { App as ScheduleEditor } from './App';
import type { AppData } from './domain';
import type { Storage } from './storage';
const steps = ['Добро пожаловать', 'Звонки', 'Расписание', 'Внешний вид', 'Готово'];
export function Onboarding({
  step,
  data,
  busy,
  dirty,
  editorStorage,
  preferences,
  onDirty,
  onStep,
  onFinish,
}: {
  step: number;
  data: AppData;
  busy: boolean;
  dirty: boolean;
  editorStorage: Storage;
  preferences: ReactNode;
  onDirty: (dirty: boolean) => void;
  onStep: (step: number) => void;
  onFinish: () => void;
}) {
  const last = step === steps.length - 1;
  return (
    <div className="onboarding">
      <header className="onboarding-header">
        <span className="brand-icon">У</span>
        <div>
          <p className="eyebrow">ПЕРВЫЙ ЗАПУСК</p>
          <h1>Настроим ваш рабочий день</h1>
        </div>
        <span className="badge">
          Шаг {step + 1} из {steps.length}
        </span>
      </header>
      <ol className="steps">
        {steps.map((label, i) => (
          <li key={label} aria-current={step === i ? 'step' : undefined}>
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <section className="welcome panel">
          <p className="eyebrow">МЕНЬШЕ ЗАБОТ О ЗАВТРАШНЕМ ДНЕ</p>
          <h2>
            Ваше расписание.
            <br />
            Всегда под рукой.
          </h2>
          <p>
            Один раз заполните неделю — помощник покажет ближайший день с занятиями. Без
            регистрации, интернета и лишних действий.
          </p>
          <div className="welcome-features">
            <span>01 · Настройте звонки</span>
            <span>02 · Добавьте классы</span>
            <span>03 · Выберите внешний вид</span>
          </div>
        </section>
      ) : step === 1 || step === 2 ? (
        <div className="embedded-editor">
          <ScheduleEditor
            key={step}
            initialTab={step === 1 ? 'bells' : 'schedule'}
            storage={editorStorage}
            onDirty={onDirty}
          />
        </div>
      ) : step === 3 ? (
        preferences
      ) : (
        <section className="welcome panel">
          <p className="eyebrow">ВСЁ ГОТОВО</p>
          <h2>Завтра стало понятнее.</h2>
          <p>
            {data.lessons.length
              ? 'Расписание сохранено. Откройте виджет и продолжайте работать как обычно.'
              : 'Можно начать с пустого виджета и добавить уроки позднее в настройках.'}
          </p>
        </section>
      )}
      <footer className="onboarding-footer">
        <button disabled={step === 0 || busy} onClick={() => onStep(step - 1)}>
          Назад
        </button>
        <span>
          {dirty
            ? 'Сохраните изменения перед продолжением.'
            : 'Все настройки можно изменить позже.'}
        </span>
        <button
          className="primary"
          disabled={dirty || busy}
          onClick={() => (last ? onFinish() : onStep(step + 1))}
        >
          {last ? 'Открыть виджет' : 'Продолжить'}
        </button>
      </footer>
    </div>
  );
}
