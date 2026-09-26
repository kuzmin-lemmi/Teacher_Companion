export function ConfirmDialog({
  message,
  title = 'Несохранённые изменения',
  confirmLabel = 'Выйти без сохранения',
  onCancel,
  onConfirm,
}: {
  message: string;
  title?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Tab') {
            const buttons = event.currentTarget.querySelectorAll('button');
            const first = buttons[0],
              last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{message}</p>
        <div>
          <button autoFocus onClick={onCancel}>
            Остаться
          </button>
          <button className="primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
